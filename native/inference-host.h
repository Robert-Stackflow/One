#pragma once
#include <psapi.h>
#include <cerrno>

struct InferenceHandle {
 HANDLE value = nullptr;
 explicit InferenceHandle(HANDLE handle = nullptr) : value(handle) {}
 ~InferenceHandle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
 InferenceHandle(const InferenceHandle&) = delete;
 InferenceHandle& operator=(const InferenceHandle&) = delete;
};
static bool inferenceNumber(const wchar_t* text, unsigned long long& result) {
 if (!text || !*text || *text == L'-') return false;
 wchar_t* end = nullptr; errno = 0; result = wcstoull(text, &end, 10);
 return !errno && end && !*end;
}
static std::wstring inferenceQuote(const std::wstring& value) {
 std::wstring out = L"\""; size_t slashes = 0;
 for (const auto ch : value) {
  if (ch == L'\\') { ++slashes; continue; }
  out.append(slashes * (ch == L'"' ? 2 : 1) + (ch == L'"' ? 1 : 0), L'\\'); slashes = 0; out += ch;
 }
 out.append(slashes * 2, L'\\'); out += L'"'; return out;
}
static std::string inferenceCreation(HANDLE process) {
 FILETIME created{}, exited{}, kernel{}, user{};
 if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return {};
 std::ostringstream output; output << std::hex << std::setfill('0') << std::setw(8) << created.dwHighDateTime << std::setw(8) << created.dwLowDateTime;
 return output.str();
}
// The host is the only holder of the job handle. Its death also kills every owned descendant.
static int inferenceHost(int argc, wchar_t** argv) {
 unsigned long long budget = 0;
 if (argc < 4 || !inferenceNumber(argv[2], budget) || budget < 128 || budget > 32768) return 2;
 const std::wstring executable = argv[3];
 const bool drive = executable.size() > 3 && executable[1] == L':' && (executable[2] == L'\\' || executable[2] == L'/');
 if (!drive && executable.rfind(L"\\\\", 0) != 0) return 2;
 InferenceHandle job(CreateJobObjectW(nullptr, nullptr));
 InferenceHandle completion(CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1));
 if (!job.value || !completion.value) return 3;
 JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
 limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
 limits.ProcessMemoryLimit = static_cast<SIZE_T>(budget) * 1024 * 1024;
 limits.JobMemoryLimit = limits.ProcessMemoryLimit;
 JOBOBJECT_ASSOCIATE_COMPLETION_PORT port{}; port.CompletionKey = job.value; port.CompletionPort = completion.value;
 if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) ||
     !SetInformationJobObject(job.value, JobObjectAssociateCompletionPortInformation, &port, sizeof(port))) return 3;
 SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
 const auto input = GetStdHandle(STD_INPUT_HANDLE), logs = GetStdHandle(STD_ERROR_HANDLE);
 if (!input || input == INVALID_HANDLE_VALUE || !logs || logs == INVALID_HANDLE_VALUE) return 3;
 SetHandleInformation(logs, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
 SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
 InferenceHandle empty(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, 0, nullptr));
 if (empty.value == INVALID_HANDLE_VALUE) return 3;
 std::wstring command = inferenceQuote(executable);
 for (int index = 4; index < argc; ++index) { command += L' '; command += inferenceQuote(argv[index]); }
 const auto directory = executable.substr(0, executable.find_last_of(L"\\/"));
 SIZE_T attributeBytes = 0; InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
 std::vector<BYTE> attributes(attributeBytes); STARTUPINFOEXW startup{};
 startup.StartupInfo.cb = sizeof(startup); startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
 startup.StartupInfo.hStdInput = empty.value; startup.StartupInfo.hStdOutput = logs; startup.StartupInfo.hStdError = logs;
 startup.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
 if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attributeBytes)) return 3;
 HANDLE inherited[] = {empty.value, logs};
 if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr, nullptr)) {
  DeleteProcThreadAttributeList(startup.lpAttributeList); return 3;
 }
 PROCESS_INFORMATION raw{};
 const bool created = CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                     nullptr, directory.c_str(), &startup.StartupInfo, &raw) != FALSE;
 DeleteProcThreadAttributeList(startup.lpAttributeList); if (!created) return 4;
 InferenceHandle process(raw.hProcess), thread(raw.hThread);
 if (!AssignProcessToJobObject(job.value, process.value)) { TerminateProcess(process.value, 4); WaitForSingleObject(process.value, INFINITE); return 4; }
 const auto creation = inferenceCreation(process.value);
 if (creation.empty()) { TerminateJobObject(job.value, 4); WaitForSingleObject(process.value, INFINITE); return 4; }
 std::cout << "{\"type\":\"started\",\"protocol\":1,\"pid\":" << raw.dwProcessId << ",\"creation\":\"" << creation << "\"}" << std::endl;
 if (ResumeThread(thread.value) == static_cast<DWORD>(-1)) { TerminateJobObject(job.value, 4); WaitForSingleObject(process.value, INFINITE); return 4; }
 bool exceeded = false, stopping = false;
 for (;;) {
  const auto status = WaitForSingleObject(process.value, 200);
  DWORD event = 0; ULONG_PTR key = 0; OVERLAPPED* value = nullptr;
  while (GetQueuedCompletionStatus(completion.value, &event, &key, &value, 0)) {
   if (event == JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT || event == JOB_OBJECT_MSG_JOB_MEMORY_LIMIT) exceeded = true;
  }
  PROCESS_MEMORY_COUNTERS_EX memory{}; memory.cb = sizeof(memory);
  if (K32GetProcessMemoryInfo(process.value, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory), sizeof(memory))) {
   std::cout << "{\"type\":\"memory\",\"pid\":" << raw.dwProcessId << ",\"rss\":" << memory.WorkingSetSize
             << ",\"peak\":" << memory.PeakWorkingSetSize << ",\"commit\":" << memory.PrivateUsage << "}" << std::endl;
   if (memory.PeakWorkingSetSize > limits.ProcessMemoryLimit || memory.PrivateUsage > limits.ProcessMemoryLimit) exceeded = true;
  }
  if (exceeded && !stopping) { std::cout << "{\"type\":\"resource\"}" << std::endl; TerminateJobObject(job.value, 70); stopping = true; }
  DWORD available = 0;
  const bool connected = PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr) != FALSE;
  if (!stopping && (!connected || available)) {
   if (available) { char bytes[64]; DWORD received = 0; ReadFile(input, bytes, sizeof(bytes), &received, nullptr); }
   TerminateJobObject(job.value, 0); stopping = true;
  }
  if (status == WAIT_OBJECT_0) break;
  if (status == WAIT_FAILED) { TerminateJobObject(job.value, 5); WaitForSingleObject(process.value, INFINITE); return 5; }
 }
 DWORD code = 0; if (!GetExitCodeProcess(process.value, &code)) return 5;
 TerminateJobObject(job.value, code);
 const auto deadline = GetTickCount64() + 5000;
 for (;;) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(job.value, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), nullptr)) return 5;
  if (!accounting.ActiveProcesses) break;
  if (GetTickCount64() >= deadline) return 5;
  Sleep(10);
 }
 std::cout << "{\"type\":\"exit\",\"pid\":" << raw.dwProcessId << ",\"code\":" << code << "}" << std::endl;
 return exceeded ? 70 : code == 0 ? 0 : 6;
}
// A PID is accepted only together with its creation timestamp, so reuse cannot bind another process.
static int inferenceWait(int argc, wchar_t** argv) {
 unsigned long long pid = 0, timeout = 0;
 if (argc != 5 || !inferenceNumber(argv[2], pid) || !pid || pid > MAXDWORD || !inferenceNumber(argv[4], timeout) || timeout > 30000) return 2;
 std::wstring wide = argv[3]; if (wide.size() != 16 || wide.find_first_not_of(L"0123456789abcdef") != std::wstring::npos) return 2;
 InferenceHandle process(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid)));
 if (!process.value) return GetLastError() == ERROR_INVALID_PARAMETER ? 0 : 3;
 std::string expected; for (const auto ch : wide) expected += static_cast<char>(ch);
 if (inferenceCreation(process.value) != expected) return 0;
 return WaitForSingleObject(process.value, static_cast<DWORD>(timeout)) == WAIT_OBJECT_0 ? 0 : 3;
}

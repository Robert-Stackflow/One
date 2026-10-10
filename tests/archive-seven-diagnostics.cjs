const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync, spawn} = require('node:child_process');
const Module = require('node:module');
const {build} = require('esbuild');
const option = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
  const writer = option('writer', '7z');
  const native = path.resolve(option('native', 'dist/native/One.Archive.exe'));
  const baseline = process.argv.includes('--baseline');
  const report = option('report');
  if (report) assert(!await fs.stat(report).catch(() => null), 'Refuse existing report');
  await fs.mkdir('work/temp', {recursive: true});
  const root = await fs.mkdtemp(path.resolve('work/temp/one-seven-diagnostics-'));
  const records = [];
  let service;
  try {
    const compiled = await build({entryPoints: ['src/main/archive-service.ts'], bundle: true,
      platform: 'node', format: 'cjs', write: false});
    const filename = path.join(path.dirname(path.dirname(native)), 'main/diagnostics.cjs');
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = module.paths;
    mod._compile(compiled.outputFiles[0].text, filename);
    service = new mod.exports.ArchiveService(path.join(root, 'cache'), () => {});
    const data = Buffer.concat(Array.from({length: 8192}, (_, i) =>
      crypto.createHash('sha256').update('7z diagnostics ' + i).digest()));
    await fs.writeFile(path.join(root, 'payload.bin'), data);
    const invoke = (operation, source, password = '', destination) => {
      const text = Buffer.from(password), frame = Buffer.alloc(4);
      frame.writeUInt32LE(text.length);
      const args = operation === 'extract' ? [operation, source, destination, '', '0'] :
        operation === 'list' ? [operation, source, '0', '500', '0'] : [operation, source];
      const result = spawnSync(native, args, {windowsHide: true, encoding: 'utf8',
        input: Buffer.concat([frame, text]), timeout: 30000, maxBuffer: 64000,
        env: {...process.env, ONE_TEST_MODE: '1', ONE_ARCHIVE_THREADS: '1', ONE_ARCHIVE_MEMORY_MIB: '256'}});
      assert(!result.error, String(result.error));
      const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row));
      return {status: result.status, rows, error: rows.find(row => row.type === 'error')};
    };
    const external = args => spawnSync(writer, args, {cwd: root, windowsHide: true,
      encoding: 'utf8', timeout: 30000, maxBuffer: 16000});
    for (const encryption of ['none', 'data', 'header']) {
      const password = encryption === 'none' ? '' : 'diagnostics-password';
      const target = path.join(root, '中文-' + encryption + '.7z');
      const made = external(['a', '-t7z', '-mx=0', '-mmt=1', '-bso0', '-bsp0',
        ...(password ? ['-p' + password, '-mhe=' + (encryption === 'header' ? 'on' : 'off')] : []),
        target, 'payload.bin']);
      assert.equal(made.status, 0, made.stderr);
      const intact = await fs.readFile(target), members = [];
      for (let offset = 0, index = 1; offset < intact.length; offset += 32768, index++) {
        const member = target + '.' + String(index).padStart(3, '0');
        members.push(member);
        await fs.writeFile(member, intact.subarray(offset, offset + 32768));
      }
      assert(members.length >= 5);
      for (const source of [target, members[0]]) {
        assert.equal(external(['t', '-y', '-bso0', '-bsp0', ...(password ? ['-p' + password] : []), source]).status, 0);
        for (const operation of ['list', 'test']) {
          const result = invoke(operation, source, password);
          assert.equal(result.status, 0, JSON.stringify(result));
        }
        const destination = path.join(root, encryption + (source === target ? '-single' : '-split'));
        assert.equal(invoke('extract', source, password, destination).status, 0);
        assert.equal(digest(await fs.readFile(path.join(destination, 'payload.bin'))), digest(data));
      }
      const damaged = [
        ['missing-middle', members[2], null],
        ['missing-last', members.at(-1), null],
        ['truncated-last', members.at(-1), (await fs.readFile(members.at(-1))).subarray(0, 8)],
        ['truncated-single', target, intact.subarray(0, intact.length - 16)],
      ];
      for (const [name, changed, replacement] of damaged) {
        const original = await fs.readFile(changed);
        if (replacement) await fs.writeFile(changed, replacement); else await fs.unlink(changed);
        try {
          const source = name === 'truncated-single' ? target : members[0];
          const messages = [];
          assert.notEqual(external(['t', '-y', '-bso0', '-bsp0', ...(password ? ['-p' + password] : []), source]).status, 0);
          const expected = name === 'truncated-single' ? /^7Z archive is incomplete or truncated$/ : /^Incomplete 7Z volume set near: /;
          for (const operation of ['list', 'test', 'extract']) {
            const destination = path.join(root, encryption + '-' + name + '-' + operation);
            const result = invoke(operation, source, password, destination);
            assert.equal(result.status, 2, JSON.stringify(result));
            assert.equal(result.error.code, 'archive');
            messages.push(result.error.message);
            if (baseline) assert.doesNotMatch(result.error.message, expected);
            else {
              assert.match(result.error.message, expected);
              if (name !== 'truncated-single') {
                const last = name === 'missing-middle' ? members[1] : members.at(-1);
                const next = name === 'missing-middle' ? members[2] : name === 'missing-last' ? members.at(-1) : target + '.' + String(members.length + 1).padStart(3, '0');
                // Missing-last ends one file earlier than truncated-last.
                assert(result.error.message.includes(path.basename(name === 'missing-last' ? members.at(-2) : last)));
                assert(result.error.message.includes(path.basename(next)));
              }
            }
            assert(!result.rows.some(row => row.type === 'result'));
            assert(!await fs.stat(destination).catch(() => null));
          }
          if (!baseline) {
            await assert.rejects(service.run(1, {operation: 'list', path: source, password}),
              name === 'truncated-single' ? /7Z 压缩包不完整或已被截断/ : /7Z 分卷不完整/);
          }
          records.push({encryption, name, operations: 3, messages});
        } finally {
          await fs.writeFile(changed, original);
          assert.equal(digest(await fs.readFile(changed)), digest(original));
        }
      }
      if (encryption === 'none') {
        const ready = path.join(root, 'lock-ready');
        const locked = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          "$file=[System.IO.File]::Open($env:ONE_DIAGNOSTIC_LOCK_PATH,'Open','Read','None'); try { [System.IO.File]::WriteAllText($env:ONE_DIAGNOSTIC_LOCK_READY,'ready'); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }"],
          {windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: {...process.env,
            ONE_DIAGNOSTIC_LOCK_PATH: members[2], ONE_DIAGNOSTIC_LOCK_READY: ready}});
        const finished = new Promise((resolve, reject) => {locked.once('error', reject); locked.once('exit', resolve);});
        let lockError = '';
        locked.stderr.on('data', bytes => {lockError = (lockError + bytes).slice(-1000);});
        try {
          for (let i = 0; i < 100 && !await fs.stat(ready).catch(() => null); i++)
            await new Promise(resolve => setTimeout(resolve, 50));
          assert(await fs.stat(ready).catch(() => null), 'Lock helper not ready: ' + lockError);
          const result = invoke('list', members[0]);
          assert.equal(result.status, 2);
          if (baseline) assert.doesNotMatch(result.error.message, /^Cannot read 7Z volume:/);
          else {
            assert.equal(result.error.message, 'Cannot read 7Z volume: ' + path.basename(members[2]));
            await assert.rejects(service.run(1, {operation: 'list', path: members[0]}), /无法读取 7Z 分卷.*文件占用和读取权限/);
          }
          records.push({name: 'exclusively-locked-middle-volume'});
        } finally {locked.stdin.end('\n'); await finished;}
        assert.equal(invoke('test', members[0]).status, 0);
      }
      if (password) {
        for (const source of [target, members[0]]) {
          const wrong = invoke(encryption === 'header' ? 'list' : 'test', source, 'wrong-password');
          assert.equal(wrong.status, 2);
          assert.doesNotMatch(wrong.error.message, /incomplete|Cannot read 7Z volume/i);
          if (encryption === 'header') {
            assert.equal(invoke('list', source).error.code, 'password');
            if (!baseline) {
              await assert.rejects(service.run(1, {operation: 'list', path: source}), /此压缩包需要密码.*密码与编码/);
              await assert.rejects(service.run(1, {operation: 'list', path: source, password: 'wrong-password'}),
                /无法打开压缩包.*文件格式.*分卷.*密码/);
            }
          }
        }
      }
      const corrupt = Buffer.from(intact); corrupt[12] ^= 0x80;
      await fs.writeFile(target, corrupt);
      const badHeader = invoke('list', target, password);
      assert.equal(badHeader.status, 2);
      assert.doesNotMatch(badHeader.error.message, /incomplete|Cannot read 7Z volume/i);
      await fs.writeFile(target, intact);
      assert.equal(invoke('test', target, password).status, 0);
      records.push({encryption, name: 'valid-hashes-password-and-header-controls', hashes: 2});
    }
    const encryptedZip = path.join(root, 'encrypted.zip');
    assert.equal(external(['a', '-tzip', '-mem=AES256', '-pdiagnostics-password', '-bso0', '-bsp0', encryptedZip, 'payload.bin']).status, 0);
    assert.equal(invoke('test', encryptedZip).error.code, 'password');
    assert.equal(invoke('test', encryptedZip, 'diagnostics-password').status, 0);
    if (!baseline) await assert.rejects(service.run(1, {operation: 'test', path: encryptedZip}), /此压缩包需要密码.*密码与编码/);
    records.push({name: 'zip-password-required-control'});
    // Empty archives and trailing bytes are legal; neither implies a missing volume.
    const empty = path.join(root, 'empty.7z');
    await fs.mkdir(path.join(root, 'empty-input'));
    assert.equal(external(['a', '-t7z', '-bso0', '-bsp0', empty, 'empty-input/*']).status, 0);
    assert.equal((await fs.stat(empty)).size, 32, 'Writer must produce a truly empty 7Z');
    assert.equal(invoke('list', empty).status, 0);
    await fs.appendFile(empty, Buffer.alloc(128));
    assert.equal(invoke('list', empty).status, 0);
    records.push({name: 'empty-and-trailing-bytes'});
    if (report) await fs.writeFile(report, JSON.stringify({baseline, native,
      nativeSha256: digest(await fs.readFile(native)), records}, null, 2) + '\n');
    console.log('7Z diagnostics passed: 3 encryption modes, 12 damaged sets, 36 failure operations, 6 output hashes and password/header controls.');
  } finally {
    await service?.stop();
    const actual = await fs.realpath(root), parent = await fs.realpath('work/temp');
    const relative = path.relative(parent, actual);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(actual, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
  }
}
main().catch(error => {console.error(String(error.stack || error).slice(-1800)); process.exitCode = 1;});

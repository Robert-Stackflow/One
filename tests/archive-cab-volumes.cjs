const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const Module = require('node:module');
const {build} = require('esbuild');
const option = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const native = path.resolve(option('native', 'dist/native/One.Archive.exe'));
  const report = option('report');
  const windowsReader = option('windows-reader');
  if (report) assert(!await fs.stat(report).catch(() => null), 'Refuse existing report');
  await fs.mkdir('work/temp', {recursive: true});
  const root = await fs.mkdtemp(path.resolve('work/temp/one-cab-volumes-'));
  const records = [];
  let service, checks = 0, hashes = 0;
  const external = (command, args, cwd = root) => {
    const result = spawnSync(command, args, {cwd, windowsHide: true, encoding: 'utf8',
      timeout: 30000, maxBuffer: 16000});
    assert(!result.error, String(result.error));
    assert.equal(result.status, 0, command + ': ' + (result.stdout + result.stderr).slice(-1500));
    return result;
  };
  const verify = async (output, selected) => {
    assert.deepEqual((await fs.readdir(output, {recursive: true})).filter(x => !selected.some(y => y.name.startsWith(x + path.sep))).sort(), selected.map(x => x.name).sort());
    for (const item of selected) {
      assert.equal(digest(await fs.readFile(path.join(output, item.name))), item.sha256, item.name);
      hashes++;
    }
    checks++;
  };
  try {
    const compiled = await build({entryPoints: ['src/main/archive-service.ts'], bundle: true,
      platform: 'node', format: 'cjs', write: false});
    const filename = path.join(path.dirname(path.dirname(native)), 'main/cab-volumes.cjs');
    const mod = new Module(filename); mod.filename = filename; mod.paths = module.paths;
    mod._compile(compiled.outputFiles[0].text, filename);
    service = new mod.exports.ArchiveService(path.join(root, 'cache'), () => {});
    const run = request => service.run(1, request);
    const browse = {directory: '', search: '', flat: true};
    const input = path.join(root, 'input'); await fs.mkdir(input);
    let state = 0x59e12345;
    const payload = Buffer.alloc(220000);
    for (let i = 0; i < payload.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5; payload[i] = state & 255;
    }
    const entries = [
      {name: 'head.txt', bytes: Buffer.from('CAB prefix\r\n')},
      {name: 'large.bin', bytes: payload},
      {name: 'tail.txt', bytes: Buffer.from('CAB spanning independent writer\r\n')},
    ].map(item => ({...item, sha256: digest(item.bytes)}));
    for (const item of entries) await fs.writeFile(path.join(input, item.name), item.bytes);
    for (const method of ['MSZIP', 'LZX', 'NONE']) {
      const folder = path.join(root, method); await fs.mkdir(folder);
      const ddf = [
        '.OPTION EXPLICIT', '.Set Cabinet=ON', '.Set Compress=' + (method === 'NONE' ? 'OFF' : 'ON'),
        '.Set CompressionType=' + (method === 'NONE' ? 'MSZIP' : method),
        '.Set CabinetNameTemplate=part*.cab', '.Set DiskDirectoryTemplate=' + folder,
        '.Set MaxDiskSize=65536', '.Set MaxCabinetSize=65000',
        '.Set CabinetFileCountThreshold=0', '.Set FolderFileCountThreshold=0', '.Set FolderSizeThreshold=0',
        '.Set InfFileName=' + path.join(folder, 'setup.inf'), '.Set RptFileName=' + path.join(folder, 'setup.rpt'),
        ...entries.map(item => '"' + path.join(input, item.name) + '" ' + item.name), '',
      ].join('\r\n');
      const directive = path.join(folder, 'input.ddf'); await fs.writeFile(directive, ddf);
      external('makecab.exe', ['/F', directive]);
      const names = (await fs.readdir(folder)).filter(name => /^part\d+\.cab$/.test(name)).sort();
      assert.equal(names.length, 4, method + ' must span four cabinets');
      const source = path.join(folder, names[0]);
      const oracle = path.join(root, method + '-oracle'); await fs.mkdir(oracle);
      if (windowsReader) external(path.resolve(windowsReader), [source, oracle]);
      else external(option('reader', '7z'), ['x', '-y', '-bso0', '-bsp0', '-o' + oracle, source]);
      await verify(oracle, entries);
      const summaries = [];
      for (const name of names) {
        const archive = path.join(folder, name);
        const listing = await run({operation: 'list', path: archive, browse});
        assert.equal(listing.editable, false); assert.equal(listing.total, entries.length);
        assert.deepEqual(listing.entries.map(x => x.name).sort(), entries.map(x => x.name).sort());
        assert.equal((await run({operation: 'test', path: archive})).count, entries.length);
        checks += 2;
        const output = path.join(root, method + '-' + name + '-out'); await fs.mkdir(output);
        await run({operation: 'extract', path: archive, parent: output, destination: 'here'});
        await verify(output, entries);
        const tail = listing.entries.find(x => x.name === 'tail.txt');
        const selection = path.join(root, method + '-' + name + '-selected'); await fs.mkdir(selection);
        await run({operation: 'extract', path: archive, revision: listing.revision, selected: [tail.index], parent: selection, destination: 'here'});
        await verify(selection, entries.filter(x => x.name === 'tail.txt'));
        summaries.push({name, total: listing.total, revision: listing.revision});
      }
      const clone = async label => {
        const destination = path.join(root, method + '-' + label); await fs.mkdir(destination);
        for (const name of names) await fs.copyFile(path.join(folder, name), path.join(destination, name));
        return destination;
      };
      for (const damage of ['missing-middle', 'missing-last', 'missing-first', 'truncated-last', 'wrong-set', 'wrong-order', 'unsafe-next', 'self-next']) {
        const broken = await clone(damage);
        let start = names[0];
        if (damage.startsWith('missing')) {
          const index = damage === 'missing-first' ? 0 : damage === 'missing-middle' ? 1 : names.length - 1;
          await fs.unlink(path.join(broken, names[index]));
          if (damage === 'missing-first') start = names[1];
        } else if (damage === 'truncated-last') {
          const last = path.join(broken, names.at(-1)); const bytes = await fs.readFile(last);
          await fs.writeFile(last, bytes.subarray(0, 30));
        } else if (damage === 'wrong-set' || damage === 'wrong-order') {
          const middle = path.join(broken, names[1]); const bytes = await fs.readFile(middle);
          bytes[damage === 'wrong-set' ? 32 : 34] ^= 1; await fs.writeFile(middle, bytes);
        } else {
          const first = path.join(broken, names[0]); const bytes = await fs.readFile(first);
          assert.equal(bytes.readUInt16LE(30), 2); assert.equal(bytes.subarray(36, 45).toString(), names[1]);
          bytes.write(damage === 'self-next' ? names[0] : '../x2.cab', 36, 'ascii'); await fs.writeFile(first, bytes);
        }
        const output = path.join(broken, 'out'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep.txt'), 'preserve');
        for (const operation of ['list', 'test', 'extract']) {
          await assert.rejects(run({operation, path: path.join(broken, start), browse, parent: output, destination: 'here'}), undefined, method + ': ' + damage + ': ' + operation);
          checks++;
        }
        assert.deepEqual(await fs.readdir(output), ['keep.txt']); assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'preserve'); checks++;
      }
      for (const damage of ['corrupt-body', 'truncated-body']) {
        const broken = await clone(damage), last = path.join(broken, names.at(-1));
        const bytes = await fs.readFile(last);
        if (damage === 'corrupt-body') { bytes[bytes.length - 1] ^= 1; await fs.writeFile(last, bytes); }
        else await fs.writeFile(last, bytes.subarray(0, bytes.length - 10));
        const output = path.join(broken, 'out'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep.txt'), 'preserve');
        for (const operation of ['test', 'extract']) {
          await assert.rejects(run({operation, path: path.join(broken, names[0]), parent: output, destination: 'here'}), undefined, method + ': ' + damage + ': ' + operation);
          checks++;
        }
        assert.deepEqual(await fs.readdir(output), ['keep.txt']); assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'preserve'); checks++;
      }
      // A revision must cover every associated cabinet, including volumes that
      // don't contain the selected entry. Never reuse a stale selection.
      const changed = await clone('中文-😀-changed'); const first = path.join(changed, names[0]);
      const listing = await run({operation: 'list', path: first, browse});
      const other = path.join(changed, names[2]); const original = await fs.readFile(other);
      const modified = Buffer.from(original); modified[modified.length - 1] ^= 1; await fs.writeFile(other, modified);
      const output = path.join(changed, 'out'); await fs.mkdir(output);
      await assert.rejects(run({operation: 'extract', path: first, revision: listing.revision,
        selected: [listing.entries.find(x => x.name === 'head.txt').index], parent: output, destination: 'here'}), /changed|变化|版本/i);
      assert.deepEqual(await fs.readdir(output), []); checks++;
      await fs.writeFile(other, original);
      assert.equal((await run({operation: 'test', path: first})).count, entries.length); checks++;
      records.push({method, volumes: await Promise.all(names.map(async name => ({name, sha256: digest(await fs.readFile(path.join(folder, name)))}))),
        independentReader: windowsReader ? 'Windows Cabinet.dll / FDICopy' : option('reader', '7z'), entries: entries.map(({name, sha256, bytes}) => ({name, sha256, bytes: bytes.length})), summaries});
    }
    const result = {checks, hashes, records};
    if (report) await fs.writeFile(report, JSON.stringify(result, null, 2) + '\n');
    console.log(`CAB volumes passed: ${checks} checks, ${hashes} SHA-256 output comparisons, 3 Windows writer methods, 12 volume entry points, 30 damaged sets.`);
  } finally {
    await service?.stop();
    const relative = path.relative(path.resolve('work/temp'), root);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

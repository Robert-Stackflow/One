function runningProcessIds(output, product) {
  const image=`${product}.exe`.toLowerCase();
  return output.split(/\r?\n/)
    .map(line=>/^"([^"]+)","(\d+)"/.exec(line))
    .filter(match=>match?.[1].toLowerCase()===image)
    .map(match=>Number(match[2]));
}

function directoryArgument(directory) {
  return `--one-setup-directory=${Buffer.from(directory,'utf8').toString('base64url')}`;
}

function elevationCommand(executable, directory) {
  const argument=directoryArgument(directory);
  const payload=Buffer.from(JSON.stringify({executable,argument}),'utf8').toString('base64');
  return `$launch=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json);Start-Process -FilePath $launch.executable -ArgumentList @($launch.argument) -Verb RunAs -ErrorAction Stop`;
}

// Query the filesystem containing the actual installation parent (including
// mounted folders). PowerShell PSDrive.Free can be null even on a healthy disk.
async function checkDiskSpace(directory, statfs) {
  let stats;
  try {
    stats=await statfs(directory,{bigint:true});
    if(typeof stats?.bavail!=='bigint'||typeof stats?.bsize!=='bigint'||stats.bavail<0n||stats.bsize<=0n) throw Error('Invalid filesystem space information');
  } catch(cause) {
    throw Object.assign(Error('无法检测安装位置的可用空间',{cause}),{reason:'spaceCheck'});
  }
  if(stats.bavail*stats.bsize<1024n**3n) throw Object.assign(Error('磁盘空间不足'),{reason:'space'});
}

module.exports={runningProcessIds,directoryArgument,elevationCommand,checkDiskSpace};

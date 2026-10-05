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

module.exports={runningProcessIds,directoryArgument,elevationCommand};

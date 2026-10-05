export function elevationCommand(file:string,args:string[]):string {
 const payload=Buffer.from(JSON.stringify({file,args}),'utf8').toString('base64');
 return `$launch=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json);$oneLaunchOptions=@{FilePath=$launch.file;Verb='RunAs';ErrorAction='Stop'};if($launch.args.Count -gt 0){$oneLaunchOptions.ArgumentList=@($launch.args)};Start-Process @oneLaunchOptions`;
}

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve('.'),base=path.join(root,'work/current/cleanup-script-test');
fs.mkdirSync(base,{recursive:true});
const repo=fs.mkdtempSync(path.join(base,'case-')),current=path.join(repo,'work/current');
fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});fs.mkdirSync(current,{recursive:true});
const script=path.join(repo,'scripts/clean-generated.ps1');fs.copyFileSync(path.join(root,'scripts/clean-generated.ps1'),script);
let checks=0;
function make(name,marker=true){const folder=path.join(current,name);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'result.txt'),'retained input');if(marker)fs.writeFileSync(path.join(folder,'.one-generated-case'),'One generated case');return folder;}
function run(args={},ok=true){
 const command='[Console]::OutputEncoding=[Text.Encoding]::UTF8; $c=ConvertFrom-Json $env:ONE_CLEANUP_TEST_ARGS; $names=[string[]]@(); if($c.names){$names=[string[]]$c.names}; & $env:ONE_CLEANUP_TEST_SCRIPT -Apply:([bool]$c.apply) -CaseName $names -AllWork:([bool]$c.allWork) -VerificationCaches:([bool]$c.verification)';
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{encoding:'utf8',windowsHide:true,env:{...process.env,ONE_CLEANUP_TEST_SCRIPT:script,ONE_CLEANUP_TEST_ARGS:JSON.stringify(args)},maxBuffer:1024*1024});
 if(r.error)throw r.error;assert.equal(r.status===0,ok,(r.stderr||r.stdout).slice(0,1000));checks++;return r;
}
try{
 const done=make('completed');make('unknown',false);const active=make('active');fs.writeFileSync(path.join(active,'.active'),String(process.pid));
 const malformed=make('malformed');fs.writeFileSync(path.join(malformed,'.active'),'invalid');
 make('fixtures');
 run();assert(fs.existsSync(done));checks++;
 run({apply:true},false);
 run({apply:true,names:['../escape']},false);
 run({apply:true,names:['fixtures']},false);
 run({apply:true,names:['completed','unknown']},false);assert(fs.existsSync(done));checks++;
 run({apply:true,names:['active']},false);
 run({apply:true,names:['malformed']},false);
 run({allWork:true},false);run({verification:true},false);
 const outside=path.join(repo,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'unique');
 const linked=make('linked');fs.symlinkSync(outside,path.join(linked,'junction'),'junction');run({apply:true,names:['linked']},false);assert(fs.existsSync(path.join(outside,'keep.txt')));checks++;
 fs.symlinkSync(outside,path.join(current,'root-link'),'junction');run({apply:true,names:['root-link']},false);
 const retired=make('retired');fs.writeFileSync(path.join(retired,'.active'),'2147483647');fs.mkdirSync(path.join(retired,'nested'));fs.writeFileSync(path.join(retired,'nested/input.txt'),'generated');
 run({names:['retired']});assert(fs.existsSync(retired));checks++;
 run({apply:true,names:['completed','retired']});assert(!fs.existsSync(done)&&!fs.existsSync(retired));assert(fs.existsSync(active)&&fs.existsSync(path.join(current,'unknown/result.txt')));checks++;
 const report={result:'PASS',checks,scope:'Explicit case cleanup, preview, active/malformed records, unknown data, batch preflight, path traversal, junction boundaries and retired process records'};
 const evidence=path.join(root,'verification/repo-maintenance');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'cleanup-script.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
 const resolved=path.resolve(repo);assert(resolved.startsWith(path.resolve(base)+path.sep));fs.rmSync(resolved,{recursive:true,force:true});if(!fs.readdirSync(base).length)fs.rmdirSync(base);
}

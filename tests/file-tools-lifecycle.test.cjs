const {test}=require('node:test'),path=require('node:path');
test('file tasks clean partial results, drain startup/cancel/quit, and retain completed/recovery/foreign data',async()=>{
 await require('./file-tools-lifecycle-smoke.cjs').run(path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','file-tools-lifecycle'));
});

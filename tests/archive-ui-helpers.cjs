/** Use the shared dialogs and menu just as the visible page does. */
async function fillArchiveSources(page,paths){
 await page.locator('#archive-sources-open').click();
 await page.locator('#archive-sources').fill(paths);
 await page.locator('#archive-sources-done').click();
 await page.locator('#archive-sources-dialog').waitFor({state:'hidden'});
}
async function openArchiveEditor(page){
 if(!await page.locator('#archive-more-menu').evaluate(node=>node.matches(':popover-open')))await page.locator('#archive-list-head').click();
}
async function openArchiveOptions(page){
 if(!await page.locator('#archive-advanced-dialog').evaluate(node=>node.open))await page.locator('#archive-advanced-open').click();
}
async function closeArchiveOptions(page){
 await page.locator('#archive-advanced-done').click();await page.locator('#archive-advanced-dialog').waitFor({state:'hidden'});
}
async function setArchivePassword(page,value){
 await page.locator('#archive-decode-open').click();await page.locator('#archive-password').fill(value);
 await page.locator('#archive-decode-dialog-close').click();await page.locator('#archive-decode-dialog').waitFor({state:'hidden'});
}
async function testArchive(page){
 await openArchiveEditor(page);await page.locator('#archive-test').click();await page.locator('#archive-result-dialog').waitFor({state:'visible'});await page.locator('#archive-result-done').click();await page.locator('#archive-result-dialog').waitFor({state:'hidden'});
}
module.exports={fillArchiveSources,openArchiveEditor,openArchiveOptions,closeArchiveOptions,setArchivePassword,testArchive};

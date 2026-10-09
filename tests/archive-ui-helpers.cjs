/** Follow the page's optional path editor rather than filling a hidden control. */
async function fillArchiveSources(page,paths){
 const editor=page.locator('.archive-source-paste');
 if(!await editor.evaluate(node=>node.open))await editor.locator('summary').click();
 await page.locator('#archive-sources').fill(paths);
}
async function openArchiveEditor(page){
 const editor=page.locator('.archive-edit-options');
 if(!await editor.evaluate(node=>node.open))await editor.locator('summary').click();
}
module.exports={fillArchiveSources,openArchiveEditor};

export function getSquidlrScript() {
  return `
    await page.waitForSelector('.card-body .list-group');
    return await page.evaluate(()=>{
        return {url: document.querySelector('.card-body .list-group a.btn:first-child').href};
    }).then(async (data) => {
        await page.setContent(JSON.stringify(data));
        await page.render.content({type: 'plainText'});
        await page.done();
    });
  `;
}

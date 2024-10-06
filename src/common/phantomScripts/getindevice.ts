export function getIndeviceScript() {
  return `
    await page.waitForSelector('div#result .text-center');
    return await page.evaluate(()=>{
        return {url: document.querySelector('div#result div.row.text-center a.btn-success:last-child').href};
    }).then(async (data) => {
        await page.setContent(JSON.stringify(data));
        await page.render.content({type: 'plainText'});
        await page.done();
    });
  `;
}

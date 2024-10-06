export function getSnapScript(url: string) {
  return `
    const url = '${url}'
    await page.waitForSelector('.modal-header .btn-close');
    await page.click('.modal-header .btn-close');
    await page.focus('#download-form #url');
    await page.keyboard.type(url)
    await page.waitForDelay(100);
    await page.keyboard.press('Enter')
    await page.waitForSelector('.container .row.text-center .p-0');
    return await page.evaluate(()=>{
        return {url: document.querySelector('.container .row.text-center .p-0 a.btn:last-child').href};
    }).then(async (data) => {
        await page.setContent(JSON.stringify(data));
        await page.render.content({type: 'plainText'});
        await page.done();
    });
  `;
}

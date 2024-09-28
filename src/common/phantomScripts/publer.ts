export function getScraperScript(url: string) {
  return `
    const url = '${url}'
    await page.waitForSelector('input[name=url]');
    await page.focus('input[name=url]');
    await page.keyboard.type(url)
    await page.waitForDelay(100);
    await page.keyboard.press('Enter')
    await page.waitForSelector('div.media-container video');
    await page.waitForDelay(200);
    return await page.evaluate(()=>{
        return {url: document.querySelector('div.media-container video').src};
    }).then(async (data) => {
        await page.setContent(JSON.stringify(data));
        await page.render.content({type: 'plainText'});
        await page.done();
    });
  `
}

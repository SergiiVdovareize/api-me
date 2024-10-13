export function getPublerScript(url: string) {
  const parsedVideoSelector = 'div.media-container video';
  const parsingErrorSelector = '.alert-container .alert__content__text';
  const invalidUrlSelector = 'form.form span.error';

  const selectors = [
    parsedVideoSelector,
    parsingErrorSelector,
    invalidUrlSelector,
  ];

  return `
    const url = '${url}'
    await page.waitForSelector('input[name=url]');
    await page.focus('input[name=url]');
    await page.keyboard.type(url)
    await page.waitForDelay(200);
    await page.keyboard.press('Enter')
    await page.waitForSelector('${selectors.join(',')}');
    await page.waitForDelay(300);
    return await page.evaluate(() => {
        const parsedUrl = document.querySelector('${parsedVideoSelector}')?.src
        const parsingError = document.querySelector('${parsingErrorSelector}')?.innerText
        const invalidUrl = document.querySelector('${invalidUrlSelector}')?.innerText

        if (parsedUrl) {
          return {
            success: true,
            data: parsedUrl
          }
        }
        
        return {
          success: false,
          error: parsingError || invalidUrl || 'unknown error'
        }
    }).then(async (data) => {
        await page.setContent(JSON.stringify(data));
        await page.render.content({type: 'plainText'});
        await page.done();
    });
  `;
}

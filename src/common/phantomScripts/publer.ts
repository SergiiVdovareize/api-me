export function getPublerScript(url: string) {
  const parsedVideoSelector = 'div.media-container video';
  const parsingErrorSelector = '.alert-container .alert__content__text';
  const invalidUrlSelector = 'form.form span.error';

  const selectors = [
    parsedVideoSelector,
    parsingErrorSelector,
    invalidUrlSelector,
  ];

  const delay = 10000;

  return `
  const mainFlow = () => {
    return new Promise(async (resolve) => {
      await page.waitForSelector('input[name=url]');
      await page.waitForDelay(500);
      await page.focus('input[name=url]');
      await page.keyboard.type('${url}')
      await page.waitForDelay(200);
      await page.keyboard.press('Enter')
      await page.waitForSelector('${selectors.join(',')}');
      await page.waitForDelay(300);

      const pageResult = await page.evaluate(() => {
          const parsedUrl = document.querySelector('${parsedVideoSelector}')?.src
          const parsingError = document.querySelector('${parsingErrorSelector}')?.innerText
          const invalidUrl = document.querySelector('${invalidUrlSelector}')?.innerText

          let result;
          if (parsedUrl) {
            result = {
              success: true,
              data: parsedUrl
            }
          } else {
            result = {
              success: false,
              url: '${url}',
              error: parsingError || invalidUrl || 'unknown error'
            }
          }
          document.body.outerText = JSON.stringify(result)
      })
      resolve(pageResult)
    })
  };

  const fallbackFlow = () => {
    return new Promise(async (resolve) => {
      setTimeout(async () => {
        const pageResult = await page.evaluate(() => {
          const content = document.querySelector('#downloader').innerHTML
          const result = {
            success: false,
            url: '${url}',
            html: document.querySelector('#downloader').innerHTML
          }
          document.body.outerText = JSON.stringify(result)
        })

        resolve(pageResult);
      }, ${delay})
    })
  }

  const race = () => {
    return new Promise(resolve => {
      const promise1 = fallbackFlow()
      const promise2 = mainFlow()
      const promises = [promise1, promise2];
      Promise.any(promises).then((value) => resolve(value));
    })
  }

    const data = await race()
    await page.waitForDelay(100);
    await page.render.content({type: 'plainText'});
    await page.done();
  `;
}

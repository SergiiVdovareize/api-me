interface BoardInfo {
  key: string;
  boardLink: string;
  partnersText: string;
}

interface CreationEmailParams {
  partners: string[];
  boardLink: string;
  pin?: string | null;
}

interface RecoveryEmailParams {
  boards: BoardInfo[];
}

/**
 * Clean, lightweight email layout matching the AlphaDate brand:
 * - Font: clean sans-serif system font
 * - Header: official logo + AlphaDate typography
 * - Accent button: #D96B27 (warm terracotta orange)
 * - Clean layout without nested border boxes or badges
 * - Dividers: subtle line separating multiple boards
 */
function renderBaseEmailLayout(contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AlphaDate</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1E2538;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAF8F5; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 540px; background-color: #FFFFFF; border-radius: 20px; border: 2px solid #2A324B; overflow: hidden; box-shadow: 0 4px 16px rgba(42, 50, 75, 0.06);">
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 36px 32px 24px 32px; border-bottom: 1px solid #F0ECE4;">
              <div style="margin-bottom: 12px;">
                <img src="https://alphadate.vdovareize.me/logo.png" alt="AlphaDate Logo" width="60" height="40" style="display: block; margin: 0 auto; width: 60px; height: 40px; border: 0; outline: none; text-decoration: none;" />
              </div>
              <div style="font-size: 28px; font-weight: 800; color: #1E2538; letter-spacing: -0.5px; margin: 0;">
                AlphaDate
              </div>
              <div style="font-size: 14px; color: #6B7280; margin-top: 6px; font-weight: 400;">
                Створіть свій унікальний простір для планування побачень.
              </div>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 32px 32px 32px; background-color: #FBF9F6; border-top: 1px solid #F0ECE4;">
              <div style="font-size: 13px; color: #8F96A3; line-height: 1.5;">
                Лист надіслано сервісом <strong>AlphaDate</strong>. Бажаємо незабутніх побачень! 💖
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatPartnersWithNbsp(partners: string[]): string {
  return partners
    .map(name => `<strong>${name.trim().replace(/\s+/g, '&nbsp;')}</strong>`)
    .join('&nbsp;та&nbsp;');
}

export function renderCreationEmail(params: CreationEmailParams): string {
  const { partners, boardLink, pin } = params;
  const partnersText = formatPartnersWithNbsp(partners);

  const pinBlockHtml = pin
    ? `
      <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #EAE5DE; font-size: 14px; color: #1E2538; line-height: 1.6;">
        🔒 <strong>Безпека дошки:</strong> встановлений PIN-код: <strong style="color: #D96B27; font-size: 16px; letter-spacing: 2px;">${pin}</strong><br>
        <span style="font-size: 13px; color: #6B7280;">Збережіть його — він знадобиться для входу та редагування дошки.</span>
      </div>
    `
    : '';

  const bodyContent = `
    <div style="font-size: 22px; font-weight: 800; color: #1E2538; line-height: 1.3; margin-bottom: 8px;">
      Вітаємо! Ваша спільна дошка створена 💖
    </div>
    <div style="font-size: 16px; color: #4B5563; line-height: 1.6; margin-bottom: 24px;">
      Спільний простір для алфавітних побачень пари ${partnersText} готовий до використання.
    </div>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 28px 0;">
      <a href="${boardLink}" target="_blank" style="display: inline-block; background-color: #D96B27; color: #FFFFFF; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 36px; border-radius: 10px;">
        Відкрити спільну дошку &rarr;
      </a>
    </div>

    <!-- Quick instructions -->
    <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #EAE5DE; font-size: 14px; color: #1E2538; line-height: 1.6;">
      <div style="font-weight: 700; margin-bottom: 8px; color: #1E2538;">
        ✨ Як це працює:
      </div>
      <div style="color: #4B5563; font-size: 14px; line-height: 1.7;">
        1. Обирайте літеру алфавіту по черзі.<br>
        2. Плануйте незабутнє побачення на обрану літеру.<br>
        3. Відзначайте виконане побачення та передавайте хід партнеру!
      </div>
    </div>

    ${pinBlockHtml}

    <!-- Bookmark link -->
    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #EAE5DE; font-size: 13px; color: #6B7280; line-height: 1.5;">
      Збережіть це посилання або додайте його у закладки, щоб будь-коли повертатися до дошки:<br>
      <a href="${boardLink}" style="color: #D96B27; word-break: break-all; text-decoration: underline;">${boardLink}</a>
    </div>
  `;

  return renderBaseEmailLayout(bodyContent);
}

export function renderRecoveryEmail(params: RecoveryEmailParams): string {
  const { boards } = params;
  const isMultiple = boards.length > 1;

  const introText = isMultiple
    ? 'Ви запитали нагадування посилань на ваші дошки планування побачень AlphaDate. За вашим email знайдено такі дошки:'
    : 'Ви запитали нагадування посилання на вашу дошку планування побачень AlphaDate:';

  const boardsListHtml = boards
    .map((b, index) => {
      const title = b.partnersText ? `Дошка для ${b.partnersText}` : `Дошка (${b.key})`;
      const isLast = index === boards.length - 1;
      const separatorHtml = !isLast
        ? '<div style="margin: 24px 0; border-top: 1px solid #EAE5DE;"></div>'
        : '';

      return `
        <div style="text-align: left;">
          <div style="font-size: 18px; font-weight: 700; color: #1E2538; margin-bottom: 8px;">
            ${title}
          </div>
          <div style="font-size: 13px; color: #6B7280; margin-bottom: 14px;">
            <a href="${b.boardLink}" style="color: #D96B27; word-break: break-all; text-decoration: underline;">${b.boardLink}</a>
          </div>
          <div>
            <a href="${b.boardLink}" target="_blank" style="display: inline-block; background-color: #D96B27; color: #FFFFFF; font-size: 14px; font-weight: 700; text-decoration: none; padding: 10px 22px; border-radius: 8px;">
              Відкрити дошку &rarr;
            </a>
          </div>
        </div>
        ${separatorHtml}
      `;
    })
    .join('');

  const bodyContent = `
    <div style="font-size: 16px; color: #1E2538; line-height: 1.6; margin-bottom: 24px;">
      Привіт! ${introText}
    </div>

    ${boardsListHtml}

    <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #EAE5DE; font-size: 13px; color: #6B7280; line-height: 1.5;">
      🔒 <strong>Зверніть увагу:</strong> якщо дошка захищена PIN-кодом, використовуйте раніше встановлений 4-значний PIN-код для входу.
    </div>
  `;

  return renderBaseEmailLayout(bodyContent);
}

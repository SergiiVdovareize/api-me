export function getCurrentSeasonInfo(date: Date = new Date()): {
  seasonUk: string;
  seasonEn: string;
  monthUk: string;
  monthEn: string;
} {
  const month = date.getMonth(); // 0 = Jan, 11 = Dec
  const monthNamesUk = [
    'січень',
    'лютий',
    'березень',
    'квітень',
    'травень',
    'червень',
    'липень',
    'серпень',
    'вересень',
    'жовтень',
    'листопад',
    'грудень',
  ];
  const monthNamesEn = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  let seasonUk = 'осінь';
  let seasonEn = 'autumn';
  if (month === 11 || month === 0 || month === 1) {
    seasonUk = 'зима';
    seasonEn = 'winter';
  } else if (month >= 2 && month <= 4) {
    seasonUk = 'весна';
    seasonEn = 'spring';
  } else if (month >= 5 && month <= 7) {
    seasonUk = 'літо';
    seasonEn = 'summer';
  }

  return {
    seasonUk,
    seasonEn,
    monthUk: monthNamesUk[month],
    monthEn: monthNamesEn[month],
  };
}

export function buildDateSuggestionsPrompt(
  letter: string,
  lang = 'uk',
  date: Date = new Date(),
  count = 5
): { systemPrompt: string; userPrompt: string } {
  const isEn = lang.toLowerCase().startsWith('en');
  const seasonInfo = getCurrentSeasonInfo(date);

  if (isEn) {
    const systemPrompt = `You help couples choose date ideas in the "Alphabet Dating" (AlphaDate) game.
Respond EXCLUSIVELY with a JSON array of objects without any additional text or markdown formatting.`;

    const userPrompt = `You help couples choose date ideas in the "Alphabet Dating" game.

Game rules: the couple receives a letter of the English alphabet, and they must organize a date with a theme starting with that letter. Examples: A — Aquapark, I — Ice skating, S — Sunset.

TASK
Generate ${count} date options for the letter "${letter}". Current season: ${seasonInfo.seasonEn}.

OPTION TITLE
1. Title is an established, widely known concept: a type of venue, event, or activity that exists as a standalone category (cinema, quest, cafe, karaoke, camping, zoo, sunset).
2. Strictly: 1 word. Only if there is no established single-word name, 2 words are allowed, maximum 3 (e.g. "sunset watching").
3. No invented, descriptive, or compound names: not "movie under a blanket on the balcony", but "cinema"; not "cooking course for cabbage dishes", but "culinary workshop"; not "bookstore with watermelon", but "bookstore".
4. First word starts with the letter "${letter}". Real, common words understood by everyone.
5. Title contains only words: no parentheses, quotation marks, dashes, colons, or prepositional phrases like "in the park", "with coffee". Put details into the description.
6. First choose the most obvious and popular options for this letter. Originality is not the goal: familiar and realistic is better than strange.

AVOIDING DUPLICATES
7. Each option must be a substantially different idea. Prohibited to provide multiple options sharing the same root or theme (jewelry workshop, jewelry store, jewelry accessories). Choose one.
8. Diverse formats and budgets: free and paid, active and calm, at home and outdoors.

SEASONALITY
9. All options must be doable right now, in the season "${seasonInfo.seasonEn}". Do not suggest seasonal activities of another season (in winter — "beach", in summer — "sledding").
10. All-season options (cinema, cafe, museum) can always be suggested.
11. Mention the season in the description only where truly relevant (e.g. for a walk or picnic). In most descriptions, it should not appear.
12. If there are fewer appropriate options than ${count}, return fewer. Do not invent.

DESCRIPTION
13. Description: 1–2 simple sentences, up to 160 characters, ending with a period.
14. Describe a realistic scenario: what exactly the couple does on the date. Only real, natural things anyone can do. No weird food and drink combinations, no fabricated events, no involving third parties (sellers, waiters, strangers).
15. Do not add a separate "specific detail" just for the sake of a detail. If it doesn't follow naturally, omit it.
16. Do not use clichés: "romantic atmosphere", "unforgettable impressions", "unforgettable evening", "special closeness".
17. Address the couple politely in the plural ("Visit", "Try", "Arrange"). No words specifying gender or relationship type (boyfriend, girlfriend, partner). Neutral: "the two of you", "together".
18. Do not start all descriptions the same way and do not repeat the title verbatim at the beginning.

DIFFICULT LETTERS
For letters with few words (X, Q, Z, etc.), return as many genuine options as realistically exist. Do not invent or substitute letters. For impossible letters, return an empty array [].

QUALITY EXAMPLE (letter "B", autumn)
[
  {"title": "Bowling", "description": "Play a few games of bowling together and have a casual talk afterwards."},
  {"title": "Bakery", "description": "Stop by a cozy local bakery to try fresh pastries and warm coffee."},
  {"title": "Billiards", "description": "Book a table for a relaxed game of pool and cheer each other on."}
]
This example demonstrates only the style and simplicity level. Do not copy it if the letter is different.

RESPONSE FORMAT
Return ONLY a JSON array of objects, without explanations or markdown:
[
  {"title": "title", "description": "short description"}
]

Capitalize the first word of each title, keep the rest lowercase except proper nouns.`;

    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `Ти допомагаєш парам обирати ідеї для побачень у грі «Побачення на літеру» (AlphaDate).
Відповідай ВИКЛЮЧНО у форматі JSON-масиву об'єктів без будь-якого вступного тексту, коментарів чи markdown-розмітки.`;

  const userPrompt = `Ти допомагаєш парам обирати ідеї для побачень у грі «Побачення на літеру».

Правила гри: парі випадає літера українського алфавіту, і вони мають організувати побачення, тематика якого починається на цю літеру. Приклади: А — аквапарк, І — іподром, З — захід сонця.

ЗАВДАННЯ
Згенеруй ${count} варіантів побачення на літеру «${letter}». Поточна пора року: ${seasonInfo.seasonUk}.

НАЗВА ВАРІАНТА
1. Назва — це усталене, загальновідоме поняття: тип закладу, події чи заняття, яке існує як окрема категорія (кіно, квест, кав'ярня, караоке, кемпінг, зоопарк, захід сонця).
2. Суворо: 1 слово. Лише якщо усталеної однослівної назви немає, допускається 2 слова, максимум 3 (наприклад, «захід сонця»).
3. Заборонено вигадані, описові чи складені назви: не «кіно під ковдрою на балконі», а «кіно»; не «кулінарний курс капустяних страв», а «кулінарний майстер-клас»; не «книжковий магазин з кавуном», а «книгарня».
4. Перше слово починається на літеру «${letter}». Слова справжні, поширені, зрозумілі кожному.
5. Назва містить лише слова: без дужок, лапок, тире, двокрапок, прийменникових конструкцій на кшталт «в парку», «з кавою». Деталі пиши в опис.
6. Спершу обирай найочевидніші й найпопулярніші варіанти на цю літеру. Оригінальність не ціль: краще знайоме й реальне, ніж дивне.

УНИКНЕННЯ ПОВТОРІВ
7. Кожен варіант суттєво інша ідея. Заборонено кілька варіантів зі спільним коренем чи темою (ювелірна майстерня, ювелірний магазин, ювелірні прикраси). Обери один.
8. Варіанти різні за форматом і бюджетом: безкоштовні й платні, активні й спокійні, вдома й просто неба.

СЕЗОННІСТЬ
9. Усі варіанти мають бути здійсненними саме зараз, у пору року «${seasonInfo.seasonUk}». Не пропонуй сезонне заняття іншої пори (узимку — «пляж», влітку — «санчата»).
10. Усесезонні варіанти (кіно, кафе, музей) можна пропонувати завжди.
11. Слово про пору року в описі згадуй лише там, де воно справді важливе (наприклад, для прогулянки чи пікніка). У більшості описів його не має бути.
12. Якщо доречних варіантів менше, ніж ${count}, поверни менше. Не вигадуй.

ОПИС
13. Опис: 1–2 прості речення, до 160 символів, обов'язково з крапкою в кінці.
14. Опиши реалістичний сценарій: що саме пара робить на побаченні. Лише реальні, природні речі, які будь-хто може зробити. Без дивних поєднань їжі й напоїв, без вигаданих подій, без залучення сторонніх людей (продавців, офіціантів, незнайомців).
15. Не додавай окрему «конкретну деталь» заради деталі. Якщо вона не випливає природно, не додавай.
16. Не використовуй кліше: «романтична атмосфера», «неповторні враження», «незабутній вечір», «особлива близькість».
17. Звертайся до пари на «ви» у множині («Відвідайте», «Спробуйте», «Влаштуйте»). Без слів, що вказують на стать чи тип стосунків (друг, подруга, коханий, дівчина, хлопець). Нейтрально: «вдвох», «разом».
18. Не починай усі описи однаково й не повторюй назву дослівно на початку.

ЯКЩО ЛІТЕРА СКЛАДНА
Для літер, на які мало слів (Й, Ї, Щ, Ц, Ф, Є, Ґ, Ю, Я тощо), поверни стільки справжніх варіантів, скільки реально існує. Не вигадуй і не підтягуй слова на іншу літеру. Для «Ь» повертай порожній масив.

ПРИКЛАД ЯКОСТІ (літера «К», осінь)
[
  {"title": "Кіно", "description": "Оберіть сеанс у кінотеатрі й після фільму обговоріть його за чашкою чаю."},
  {"title": "Квест", "description": "Пройдіть квест-кімнату вдвох: разом шукайте підказки й розгадуйте загадки на час."},
  {"title": "Караоке", "description": "Забронюйте кабінку в караоке-барі й заспівайте по черзі улюблені пісні."},
  {"title": "Кав'ярня", "description": "Знайдіть затишну кав'ярню, замовте десерти на двох і просто поспілкуйтесь без поспіху."}
]
Цей приклад показує лише стиль і рівень простоти. Не копіюй його, якщо літера інша.

ФОРМАТ ВІДПОВІДІ
Поверни ТІЛЬКИ JSON-масив об'єктів, без пояснень і без markdown:
[
  {"title": "назва", "description": "короткий опис"}
]

Назви пиши з великої літери першого слова, решту з малої, крім власних назв.`;

  return { systemPrompt, userPrompt };
}

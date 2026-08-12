export const categoryDocs = {
  "_system": {
    en: "Internal graph endpoints. OUTPUT finishes value graphs and can also terminate an execution chain.",
    ru: "Внутренние конечные точки графа. OUTPUT завершает value-графы и может принимать exec-цепочку."
  },
  "_attr": {
    en: "Nodes injected into Attribute widget graphs: the current score and the output that defines the modifier button.",
    ru: "Ноды, автоматически добавляемые в графы Attribute: текущее значение характеристики и выход для кнопки модификатора."
  },
  "_skill": {
    en: "Nodes injected into Skill widget graphs: rank input and output for displayed/rolled bonus.",
    ru: "Ноды графа Skill: вход ранга навыка и выход для отображаемого/бросаемого бонуса."
  },
  "_initiative": {
    en: "World initiative graph. Its output compiles into the Foundry combat initiative formula.",
    ru: "Граф инициативы мира. Его выход компилируется в формулу инициативы Foundry."
  },
  "Flow": {
    en: "Execution control: start on click, branch, sequence, loop, delay, dialogs, casts, waits and reroutes. Flow nodes move the yellow exec wire and decide which action runs next.",
    ru: "Управление исполнением: старт по клику, ветвления, последовательности, циклы, задержки, диалоги, приведение типов, ожидания и reroute. Эти ноды ведут жёлтый exec-провод и выбирают следующее действие."
  },
  "Sources": {
    en: "Read data from actors, items, tokens, widgets, slots, compendiums, variables and random generators. Source nodes are usually pure value providers for later math/actions.",
    ru: "Чтение данных из акторов, предметов, токенов, виджетов, слотов, compendium, переменных и генераторов случайности. Обычно это чистые value-источники для математики и действий."
  },
  "Attribute": {
    en: "Attribute formulas. Converts a score into a modifier using the system modifier settings.",
    ru: "Формулы характеристик. Превращают score в modifier по настройкам системы."
  },
  "Dice": {
    en: "Build and transform dice formulas before a roll: die selection, formula range, clamps, multipliers and additions.",
    ru: "Сборка и преобразование формул костей до броска: кубы, диапазоны, ограничения, множители и добавки."
  },
  "Math": {
    en: "Pure numeric operations. Use them for derived values, DCs, resource costs, scaling damage and threshold calculations.",
    ru: "Чистая числовая математика: производные значения, DC, стоимость ресурсов, масштабирование урона и пороги."
  },
  "Compare": {
    en: "Comparisons returning booleans. Usually feed Branch, Gate, Switch or visibility logic.",
    ru: "Сравнения, возвращающие boolean. Обычно идут в Branch, Gate, Switch или условия видимости."
  },
  "Logic": {
    en: "Boolean and matching helpers. Combine checks or match numbers, strings and arrays to classify outcomes.",
    ru: "Булева логика и match-хелперы. Объединяют проверки или классифицируют числа, строки и массивы."
  },
  "Roll": {
    en: "Imperative roll actions. They post rolls/checks to chat, expose result metadata, crit/fumble flags, margins and branch outputs for hit/fail/tier logic.",
    ru: "Императивные броски. Пишут броски/проверки в чат и отдают результат, crit/fumble, margin и ветки hit/fail/tier."
  },
  "Damage": {
    en: "HP-changing actions. Damage reads resistances/immunities/vulnerabilities; Heal can be direct or chat-confirmed.",
    ru: "Действия, меняющие HP. Damage учитывает resistances/immunities/vulnerabilities; Heal может быть прямым или через карточку чата."
  },
  "Effects": {
    en: "ActiveEffect and Region automation: create/toggle/remove effects, apply templates, statuses, auras and aura save branches.",
    ru: "Автоматизация ActiveEffect и Region: создание/переключение/удаление эффектов, шаблоны, статусы, ауры и aura-save ветки."
  },
  "Array": {
    en: "Array construction, transforms, filters, sort, aggregates and iteration. Useful with targets, compendium lists, item arrays and dialog choices.",
    ru: "Создание, преобразование, фильтрация, сортировка, агрегаты и обход массивов. Полезно для целей, compendium-списков, массивов предметов и вариантов диалогов."
  },
  "Resources": {
    en: "Spend/restore spell slots, token pools and arbitrary resources. Often paired with confirmation dialogs and failure branches.",
    ru: "Трата/восстановление слотов заклинаний, пулов токенов и произвольных ресурсов. Часто используется с подтверждениями и ветками отказа."
  },
  "Field Ops": {
    en: "Write document paths and nested slot/inventory item fields. These nodes are the main bridge from graph logic to persistent Foundry data.",
    ru: "Запись путей документа и вложенных полей slot/inventory items. Это основной мост от логики графа к постоянным данным Foundry."
  },
  "Chat": {
    en: "Chat output, user notifications and sheet opening. Use for visible feedback after automation.",
    ru: "Вывод в чат, уведомления и открытие листов. Используется для видимой обратной связи после автоматики."
  },
  "Items": {
    en: "Inventory/slot operations: add/remove items, equip/unequip, use embedded items and transform item arrays.",
    ru: "Операции с инвентарём и слотами: добавить/удалить предмет, экипировать/снять, использовать вложенный предмет и обрабатывать массивы предметов."
  },
  "AI": {
    en: "Optional AI request action. Use only when the table workflow expects generated text; always keep GM/player review in the loop.",
    ru: "Опциональный AI-запрос. Используйте только там, где нужен сгенерированный текст, и оставляйте проверку GM/игроком."
  },
  "AoE": {
    en: "Place Foundry Regions for area effects, collect affected targets, apply damage/heal/effects and split save success/failure arrays.",
    ru: "Создание Foundry Regions для областей, сбор затронутых целей, применение урона/лечения/эффектов и разделение save success/failure."
  },
  "System": {
    en: "System-side actions such as sounds and macro execution.",
    ru: "Системные действия: звук и запуск макросов."
  },
  "Tables": {
    en: "RollTable actions: roll, reset and show tables.",
    ru: "Действия RollTable: бросить, сбросить и показать таблицу."
  },
  "Events": {
    en: "Document, combat, effect, damage, rest, equipment and card triggers. Event nodes register through Foundry Hooks and can run on actors/items or standalone world items.",
    ru: "Триггеры документов, боя, эффектов, урона, отдыха, экипировки и карт. Event-ноды регистрируются через Foundry Hooks и могут работать на акторах/предметах или standalone world item."
  },
  "Targeting": {
    en: "Actor/token target providers: self, named actor, first target, selected token, all targets, player actors and user character.",
    ru: "Источники целей: self, актор, первый target, selected token, все targets, акторы игроков и персонаж пользователя."
  },
  "Variables": {
    en: "Read/write graph variables for intermediate or persistent-ish state inside automation.",
    ru: "Чтение/запись переменных графа для промежуточного состояния автоматизации."
  },
  "Macros": {
    en: "Reusable subgraphs: declare macro inputs/outputs and call another graph from the current one.",
    ru: "Переиспользуемые подграфы: входы/выходы макроса и вызов другого графа из текущего."
  },
  "Journal": {
    en: "Open journal entries or pages from automation.",
    ru: "Открытие journal entries или страниц из автоматики."
  },
  "Cards": {
    en: "Foundry Cards support: shuffle, draw, play, discard, reveal, pass, recall, deal, flip and inspect stack/card state.",
    ru: "Поддержка Foundry Cards: shuffle, draw, play, discard, reveal, pass, recall, deal, flip и чтение состояния карт/стопок."
  },
  "Quest": {
    en: "Quest log automation: activate/complete/fail/lock quests, mark subtasks, reveal/grant rewards and react to quest hooks.",
    ru: "Автоматика quest log: активировать/завершить/провалить/заблокировать квесты, отмечать subtasks, раскрывать/выдавать rewards и реагировать на quest hooks."
  },
  "Widget Config": {
    en: "Nodes generated for widget configuration graphs. They expose widget fields so graphs can configure UI state declaratively.",
    ru: "Ноды, сгенерированные для графов конфигурации виджетов. Они дают доступ к полям виджета, чтобы граф мог декларативно настраивать UI."
  }
};

export const foundryNotes = {
  en: [
    "System data lives in Foundry TypeDataModel classes and manifest documentTypes/htmlFields sanitize user HTML.",
    "Sheets and editors use Foundry ApplicationV2/DialogV2 where available, with compatibility fallbacks for legacy v1 sheets.",
    "Rolls and chat cards use Roll and ChatMessage; action nodes can pass roll metadata downstream.",
    "ActiveEffect nodes create or update embedded ActiveEffect documents and support Foundry v14 change.type as well as older change.mode data.",
    "AoE and aura nodes create Foundry Region documents and use canvas token/region APIs to discover affected targets.",
    "Event nodes are registered through Hooks; sockets proxy GM-only quest actions when a player triggers them."
  ],
  ru: [
    "Данные системы описаны через Foundry TypeDataModel, а manifest documentTypes/htmlFields отвечает за sanitization HTML-полей.",
    "Листы и редакторы используют Foundry ApplicationV2/DialogV2 там, где возможно, с fallback на legacy v1 sheets.",
    "Броски и карточки чата используют Roll и ChatMessage; action-ноды передают metadata броска дальше по графу.",
    "Effect-ноды создают/обновляют embedded ActiveEffect documents и поддерживают Foundry v14 change.type вместе со старыми change.mode данными.",
    "AoE и aura-ноды создают Foundry Region documents и используют canvas token/region API для поиска затронутых целей.",
    "Event-ноды регистрируются через Hooks; socket проксирует GM-only quest actions, если их запускает игрок."
  ]
};

export const widgetUsage = {
  text: { en: "Editable one-line field bound to a document path.", ru: "Редактируемое однострочное поле, привязанное к пути документа." },
  number: { en: "Numeric input with plus/minus controls and optional min/max/step.", ru: "Числовой ввод с кнопками плюс/минус и min/max/step." },
  resource: { en: "Current/max resource bar for HP, mana, stamina or any custom path.", ru: "Полоса current/max для HP, маны, выносливости или любого custom path." },
  dice: { en: "Clickable roll button; simple rolls can work without a graph.", ru: "Кликабельная кнопка броска; простые броски работают без графа." },
  toggle: { en: "Boolean switch, commonly used with hidden fields and visibility rules.", ru: "Boolean-переключатель, часто используется с hidden fields и условиями видимости." },
  slot: { en: "Actor/item slot that contains embedded item snapshots filtered by type/category.", ru: "Слот актора/предмета с embedded item snapshots и фильтрами по типу/категории." },
  inventory: { en: "Item table with category filters, currency/weight display and extra columns.", ru: "Таблица предметов с фильтрами категорий, валютой/весом и дополнительными колонками." },
  effects: { en: "Active Effects list with visibility controls for disabled/passive effects.", ru: "Список Active Effects с контролем disabled/passive эффектов." },
  spellbook: { en: "Ability list filtered by ability type/school/category conventions.", ru: "Список ability, фильтруемый по типу/школе/категории." },
  attribute: { en: "Score + modifier widget with its own graph for modifier and click behavior.", ru: "Score + modifier с отдельным графом для модификатора и поведения по клику." },
  attributeGroup: { en: "Compact button that opens a popover of multiple attributes.", ru: "Компактная кнопка, открывающая popover с набором характеристик." },
  skill: { en: "Rank/bonus/roll widget for skill-like values.", ru: "Виджет rank/bonus/roll для навыков." },
  section: { en: "Visual divider, optionally collapsible.", ru: "Визуальный разделитель, опционально collapsible." },
  button: { en: "General action button; best entry point for custom node automation.", ru: "Универсальная action-кнопка; лучший вход для кастомной нодовой автоматики." },
  richtext: { en: "HTML notes field backed by a sanitized htmlField path.", ru: "HTML-заметки, привязанные к sanitized htmlField path." },
  progress: { en: "Read-only progress bar from value/max paths.", ru: "Read-only progress bar из value/max путей." },
  select: { en: "Dropdown bound to a path with comma-separated choices.", ru: "Dropdown, привязанный к path, с вариантами через запятую." },
  clock: { en: "Segmented progress clock for PbtA/Blades style countdowns.", ru: "Сегментные часы прогресса для PbtA/Blades countdowns." },
  tracker: { en: "Clickable pip tracker for stress, wounds, clocks or custom counters.", ru: "Кликабельный pip tracker для стресса, ран, часов или счётчиков." },
  counter: { en: "Large stepper with bounded min/max value.", ru: "Крупный stepper с ограничениями min/max." },
  rollButton: { en: "One-click roll-to-chat button.", ru: "Кнопка one-click roll-to-chat." },
  tokenPool: { en: "Spend/gain token pool UI for meta-currencies.", ru: "Пул токенов spend/gain для мета-валют." },
  diceTray: { en: "Displays the latest dice roll stored in a flag path.", ru: "Показывает последний бросок из flag path." },
  tags: { en: "Pill list of traits or keywords.", ru: "Pill-список traits/keywords." },
  image: { en: "Static or selected image preview.", ru: "Статичное/выбранное изображение." },
  vsection: { en: "Nested vertical container for grouping widgets inside a cell.", ru: "Вложенный вертикальный контейнер для группировки виджетов внутри ячейки." },
  derived: { en: "Read-only value computed from FormulaEngine.", ru: "Read-only значение, вычисленное FormulaEngine." },
  cardHand: { en: "Foundry Cards hand/deck visualizer with optional card click actions.", ru: "Визуализатор Foundry Cards hand/deck с действиями по клику карты." },
  questMarker: { en: "Shows the actor's active quest and links back to the quest log.", ru: "Показывает активный квест актора и ссылку на quest log." },
  cardDrawButton: { en: "Draw cards from a deck into a hand/pile.", ru: "Тянет карты из deck в hand/pile." }
};

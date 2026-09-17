# Українські джерела для SkyStream

Незалежний репозиторій плагінів [SkyStream](https://github.com/akashdh11/skystream).
Перший провайдер — **UAKino**, порт логіки
[CloudStream Ukrainian](https://github.com/CakesTwix/cloudstream-extensions-uk).
Статус: **beta**. UAFlix, UASerials, KinoVezha та Eneyida поки не реалізовані.

## Встановлення

У SkyStream відкрийте розділ розширень/репозиторіїв, додайте URL:

```text
https://raw.githubusercontent.com/vladislawfox/skystream-ukrainian/main/repo.json
```

Після додавання репозиторію встановіть і ввімкніть **UAKino**.
Це звичайний `.sky`-плагін; змінювати основний застосунок не потрібно.

## Що підтримується

- Каталоги фільмів, серіалів, дорам, мультфільмів, мультсеріалів та аніме.
- Пошук українською, постери, опис, рік, жанри, актори, рейтинг і трейлер.
- Серії з номерами сезону/епізоду; інші сезони доступні через рекомендації,
  відповідно до окремих сторінок сезонів на сайті та поведінки CloudStream.
- Окремі озвучення, HLS Auto та якості з master-плейлиста.
- Субтитри, якщо вони вказані плеєром; заголовки Referer/User-Agent для відео.
- Прямі та закодовані публічні посилання PlayerJS/Tortuga.

Посилання на потоки оновлюються при запуску відео; у списку серій зберігаються
сталі ідентифікатори, а не тимчасові CDN-посилання. Плагін не виконує сторонній
JavaScript із сайтів і не містить логіки обходу DRM чи інтерактивних перевірок.

## Перевірка та обмеження

Результати реальних перевірок і межі перевіреного описані у
[docs/VERIFICATION.md](docs/VERIFICATION.md). Отримання HLS-плейлиста саме по собі
не підтверджує відтворення на фізичному iPhone. Відповіді сайту можуть залежати
від HTTP-клієнта, IP та стану сесії. Повідомлення про Cloudflare означає, що
провайдер отримав сторінку перевірки замість контенту.

## Розробка

Потрібен Node.js 22 або новіший. Залежності локальні та зафіксовані lockfile.

```sh
npm ci --ignore-scripts
npm run check
# Необов'язково: живі запити до UAKino та HLS, без завантаження відео
npm run test:live
```

`npm run build` відтворює `repo.json`, `dist/plugins.json` і ZIP-пакет `.sky`.
В архіві рівно два файли: `plugin.json` і зібраний `plugin.js`. Зміни плагіна
публікуйте з більшим цілим `version` у `UAKino/plugin.json`, щоб SkyStream побачив
оновлення. Джерело — `UAKino/src/index.js`.

Для перевірки через реальний worker і HTML-парсер SkyStream на macOS, з його
сумісним Flutter SDK та встановленими залежностями:

```sh
cd /path/to/skystream
SKYSTREAM_PLUGIN_ROOT=/path/to/skystream-ukrainian \
  flutter test /path/to/skystream-ukrainian/scripts/skystream_native_test.dart
```

Цей додатковий тест використовує звичайний Dio; він не створює WebView
застосунку й не підтверджує фізичне відтворення.

[Порівняння архітектур і наступних провайдерів](docs/PROVIDER-MAPPING.md).
Ліцензія — [GPL-3.0](LICENSE), походження коду — [NOTICE](NOTICE).

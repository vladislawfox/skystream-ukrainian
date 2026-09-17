# Українські джерела для SkyStream

14 незалежних плагінів [SkyStream](https://github.com/akashdh11/skystream),
портованих із [CloudStream Ukrainian](https://github.com/CakesTwix/cloudstream-extensions-uk).
Фільми, серіали, мультфільми та дорами українською. Статус нових портів — **beta**.

## Встановлення й оновлення

У розділі репозиторіїв SkyStream додайте:

```text
https://raw.githubusercontent.com/vladislawfox/skystream-ukrainian/main/repo.json
```

Якщо репозиторій уже доданий, оновіть його список та встановіть потрібні джерела.
UAKino також отримав оновлення до версії 2: виправлено відносні URL, які піднімаються
вище кореня адреси. Посилання на репозиторій залишилося тим самим.

| Плагін | Сайт |
| --- | --- |
| UAKino | [uakino.best](https://uakino.best) |
| UAFlix | [uafix.net](https://uafix.net) |
| UASerialsPro | [uaserials.com](https://uaserials.com) |
| KinoVezha | [kinovezha.tv](https://kinovezha.tv) |
| Eneyida | [eneyida.tv](https://eneyida.tv) |
| KinoTron | [kinotron.tv](https://kinotron.tv) |
| KlonTV | [klonua.com](https://klonua.com) |
| Serialno | [serialno.tv](https://serialno.tv) |
| SimpsonsUA | [simpsonsua.tv](https://simpsonsua.tv) |
| Цікава Ідея | [cikava-ideya.top](https://cikava-ideya.top) |
| UFDub | [ufdub.com](https://ufdub.com) |
| BambooUA | [bambooua.com](https://bambooua.com) |
| DoramyWorld | [doramy.world](https://doramy.world) |
| Kinostrain | [kinostrain.com](https://kinostrain.com) |

Спеціалізовані аніме-джерела не портовані. Змішані сайти залишені, а нові порти
не додають окремих аніме-розділів на головну. Наявний UAKino зберігає свої категорії.

## iPhone та форк застосунку

Для особистого iPhone використовується [форк SkyStream](https://github.com/vladislawfox/skystream)
із системним HTTP-клієнтом Apple. На оригінальному Dart HTTP той самий запит UAKino
отримував 403, а через URLSession — 200. Виправлений білд встановлено, користувач
підтвердив роботу UAKino. Інструкція підтримки форка та оновлення з upstream —
[FORK.md](https://github.com/vladislawfox/skystream/blob/ios-local-build/FORK.md).
Джерела залишаються окремими `.sky`-плагінами; додавання нових не потребує нового білда.

## Можливості й межі перевірки

Каталог, пошук, метадані, серії, озвучення та субтитри залежать від конкретного сайту.
Плеєри PlayerJS/Ashdi/Tortuga підтримують HLS Auto та варіанти якості. Стабільні
ідентифікатори серій оновлюють відеопосилання при запуску; плагіни не зберігають
тимчасові CDN-адреси в історії.

У всіх 13 нових джерелах перевірені живі приклади отримання потоків. Це не означає,
що працює кожен матеріал: частина сторінок містить тільки трейлер, ще не має відео
або використовує непідтримуваний плеєр. Пошук KlonTV у тестовому клієнті повертав
403. Для таких випадків плагіни повертають помилки. Деталі —
[docs/VERIFICATION.md](docs/VERIFICATION.md).

Плагіни не виконують сторонній JavaScript із сайтів, не містять облікових даних
і не реалізують обхід DRM чи інтерактивних перевірок.

## Розробка

Node.js 22+, зафіксовані локальні залежності:

```sh
npm ci --ignore-scripts
npm run check
# Опційні живі перевірки; без завантаження відеосегментів:
npm run test:live
npm run test:live:all
```

`npm run build` знаходить усі `<Provider>/plugin.json` і збирає окремі архіви,
`dist/plugins.json` та `repo.json`. В архіві рівно `plugin.json` і `plugin.js`.
Зміни опублікованого плагіна потребують більшого цілого `version` у його маніфесті.
Спільні модулі розташовані у `shared/`; зміна модуля потребує перевірки й оновлення
версій усіх пакетів, які його використовують.

Для перевірки нових пакетів у реальному worker/HTML-парсері SkyStream на macOS
спочатку виконайте живий тест, потім із кореня Flutter-застосунку:

```sh
SKYSTREAM_PLUGIN_ROOT=/path/to/skystream-ukrainian \
SKYSTREAM_CASES_FILE=/path/to/skystream-ukrainian/.local/native-cases.json \
  flutter test /path/to/skystream-ukrainian/scripts/skystream_all_native_test.dart
```

Живі відповіді, cookies і тимчасові URL зберігаються лише в ігнорованій `.local/`.
[Архітектура](docs/PROVIDER-MAPPING.md), [ліцензія GPL-3.0](LICENSE),
[походження коду](NOTICE). UASerialsPro містить CryptoJS під [MIT](licenses/crypto-js.txt).

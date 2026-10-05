# Ombor hisobi

Uzum Market sotuvchisi uchun ombor hisobi. Har bir harakat alohida yozuv bo'lib saqlanadi, qoldiqni esa ilova o'zi hisoblaydi. Qoldiq hech qachon qo'lda tahrirlanmaydi va bazada alohida saqlanmaydi.

- **Sotuvchi faqat "Mahsulot keldi"ni kiritadi.** Kartochkani tanlaydi va uning barcha rang/o'lchamlari uchun sonlarni bitta ekranda yozadi. Kerak bo'lsa — "Sanab tuzatish" va "Brak".
- **Qolganini Uzum o'zi beradi**: Uzumga jo'natish (nakladnoy), sotuvlar (FBO — Uzum omboridan, **FBS — omborimdan**) va qaytarishlar avtomatik yoziladi.
- **Har bir do'kon alohida**: Uzumdagi har bir do'kon ilovada alohida; kartochkalar, qoldiq va tarix aralashmaydi. Do'kon yuqoridagi tanlagichdan almashtiriladi (Uzum seller'dagi kabi).
- **Mahsulot = kartochka, ichida variantlar (SKU)** — xuddi Uzumdagidek: "Hoodie" kartochkasi, ichida Qora M, Qora L, Oq M ... Har bir variantning o'z kodi va o'z qoldig'i bor.
- Telefon uchun qilingan, kompyuterda ham qulay. PWA sifatida telefonga o'rnatsa bo'ladi.
- Yozuvlar o'chirilmaydi. Xato bo'lsa, yozuv **bekor qilinadi**: qoldiqqa ta'sir qilmaydi, lekin tarixda ko'rinib turadi.
- Qoldiq manfiy bo'lolmaydi: ko'p kiritilsa yoki bekor qilish qoldiqni manfiy qilsa, ilova sababini tushuntirib, to'xtatadi.

## Lokal ishga tushirish

Kerak: **Node.js 22.13 yoki yangiroq** (24 tavsiya etiladi). Boshqa hech narsa kerak emas. Baza Node.js'ga o'rnatilgan SQLite (`node:sqlite`), u `data/ombor.db` faylida saqlanadi.

```bash
npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Brauzerda **http://localhost:5173** manzilini oching.

| | |
|---|---|
| Login | `sotuvchi` |
| Parol | `ombor2026` |

`npm run seed` buyrug'i bazaga 4 ta namunaviy kartochka (variantlari bilan) va bir nechta harakat qo'shadi (baza bo'sh bo'lsagina). "Hoodie oversize — Qora · L" varianti qabul mezonidagi stsenariy: keldi 100 → jo'natdim 30 → sotildi 5 → qaytdi 2, natija 72 / 23 / 95.

Oldingi versiyadagi baza avtomatik yangi tuzilmaga o'tkaziladi: har bir eski mahsulot bitta variantli kartochkaga aylanadi, barcha harakatlar o'z joyida qoladi.

### Sozlamalar (`.env`)

Login, parol va portni o'zgartirish uchun `.env.example` faylidan nusxa olib, `.env` nomi bilan saqlang:

```bash
cp .env.example .env
```

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `APP_LOGIN`, `APP_PASSWORD` | Kirish uchun login va parol | `sotuvchi` / `ombor2026` |
| `APP_PORT` | Server porti | `8787` |
| `DATA_DIR` | Baza fayli va sessiya kaliti papkasi | `data` |
| `DB_DRIVER` | Qaysi saqlash adapteri | `sqlite` |
| `SECURE_COOKIES` | HTTPS orqali ishlatilsa `1` | `0` |
| `UZUM_API_KEY` | Uzum Seller API kaliti. Bo'sh bo'lsa — integratsiya o'chiq | — |
| `UZUM_SHOP_IDS` | Faqat shu do'konlar (vergul bilan). Bo'sh — kalitning barcha do'konlari | — |
| `UZUM_SYNC_MINUTES` | Uzumdan avtomatik yangilash oralig'i, daqiqa (`0` — faqat qo'lda) | `15` |

> Ilovani internetga chiqarishdan oldin `APP_PASSWORD`ni albatta o'zgartiring.

### Telefonda ochish

Kompyuter va telefon bir Wi‑Fi tarmog'ida bo'lsa, `npm run dev` chiqargan `Network:` manzilini (masalan, `http://192.168.1.5:5173`) telefonda oching.

Telefonga ilova sifatida o'rnatish (PWA) uchun sayt **HTTPS** orqali ochilgan bo'lishi kerak (brauzer talabi). Server internetga joylashtirilgach, brauzer menyusidan "Bosh ekranga qo'shish" tugmasini bosing.

### Tayyor (production) rejim

```bash
npm run build
```

```bash
npm start
```

Endi ilova va API bitta serverda: **http://localhost:8787**.

### Testlar

```bash
npm test
```

- `domain/stock.test.ts` — qoldiq hisoblash logikasi (sof funksiyalar), qabul mezonidagi stsenariy ham shu yerda.
- `server/services/inventory.test.ts` — biznes oqimlari. **Bir xil testlar har bir saqlash adapteri uchun** (xotira va SQLite) ishga tushadi.
- `server/integrations/uzum/sync.test.ts` — Uzum sinxronlash soxta Uzum API bilan: nakladnoy → omborimdan ayirish, takrorlanmaslik, bekor qilish, son o'zgarishi, kutilayotgan yozuv, bog'lash, import.
- `server/http/app.test.ts` — API: kirish, himoya, xato javoblari.

## Tuzilma

```
domain/                 Sof logika — baza, server va brauzerga bog'liq emas
  types.ts              Kartochka, Variant, Harakat, Qoldiq turlari
  variants.ts           Xususiyatlardan variantlar yasash, artikul taklif qilish
  stock.ts              Harakat ta'siri va qoldiq hisoblash
  rules.ts              Qoidalar: manfiy qoldiq, bekor qilish, sanab tuzatish
  messages.ts           Foydalanuvchiga ko'rinadigan matnlar (o'zbekcha)
  uzum.ts               Uzum hodisalari va katalog turlari
server/
  storage/repository.ts Saqlash qatlami interfeysi (shartnoma)
  storage/sqlite/       SQLite adapteri (hozir ishlatiladi)
  storage/memory/       Xotiradagi adapter (testlar va namuna uchun)
  auth/                 Avtorizatsiya interfeysi, bitta akkauntli provayder, sessiya
  services/inventory.ts Biznes oqimlari — faqat Repository interfeysini biladi
  integrations/uzum/    Uzum: API mijozi (client), javoblarni o'girish (mapping — sof), sinxronlash (sync)
  uzum-check.ts         Uzum ulanishini tekshirish skripti (faqat o'qiydi)
  http/app.ts           API yo'llari
  container.ts          Qaysi adapter/provayder ishlatilishi faqat shu yerda hal qilinadi
web/                    Interfeys (React + Vite), PWA fayllari web/public ichida
```

Qatlamlar bir-birini shunday ko'radi:

```
web  →  HTTP API  →  InventoryService  →  Repository (interfeys)  ←  SqliteRepository
                             ↓
                    domain (sof funksiyalar)
```

Interfeys ham serverdagi bilan bir xil `domain` funksiyalarini ishlatadi: natijani oldindan ko'rsatish ("Omborda: 72 → 42") va xato xabarlari serverdagi tekshiruv bilan bir xil bo'ladi. Server baribir har bir yozuvni qaytadan tekshiradi.

## Boshqa bazaga o'tish: yangi adapter yozish

Ilovaning qolgan qismi bazani bilmaydi, faqat `server/storage/repository.ts` dagi `Repository` interfeysiga murojaat qiladi. Masalan, Postgres'ga o'tish uchun:

1. **Adapter yozing**: `server/storage/postgres/postgresRepository.ts` faylida `Repository` interfeysini amalga oshiring. Eng qisqa namuna — `server/storage/memory/memoryRepository.ts`, SQL namunasi — `server/storage/sqlite/sqliteRepository.ts`.
2. **Qoidalarga amal qiling**:
   - `insertMovement` faqat yangi yozuv qo'shadi; yozuvlar o'zgartirilmaydi va o'chirilmaydi. Yagona o'zgarish — `voidMovement` (`voided_at` ni belgilash).
   - Qoldiq ustunini **qo'shmang**: qoldiq har doim harakatlardan hisoblanadi.
   - Artikul (`code`) katta-kichik harfsiz takrorlanmas bo'lsin — solishtirish `domain/variants.ts` dagi `normalizeCode` bilan. `uzumSkuId` ham takrorlanmas.
   - `saveUzumEvent` — `externalRef` bo'yicha "qo'shish yoki yangilash".
   - `listMovements` tartibi: `date` bo'yicha kamayish, keyin `createdAt` bo'yicha kamayish.
   - `transaction(fn)` — `fn` ichidagi o'qish va yozish bir butun bajarilsin (Postgres'da `BEGIN … COMMIT` va mahsulot qatorini `SELECT … FOR UPDATE` bilan qulflash). Shu tufayli ikki so'rov bir vaqtda kelsa ham qoldiq manfiy bo'lmaydi.
3. **Ulang**: `server/container.ts` dagi `createRepository()` ga yangi `case` qo'shing va `.env` da `DB_DRIVER=postgres` qiling.
4. **Tekshiring**: `server/testing.ts` dagi `adapters` ro'yxatiga yangi adapterni qo'shing va `npm test` ni ishga tushiring. Servis va Uzum sinxronlash testlarining hammasi yangi adapterda ham ishlaydi — barchasi o'tsa, adapter tayyor.

Boshqa hech qaysi fayl (servis, API, interfeys) o'zgarmaydi.

## Avtorizatsiya

`server/auth/authProvider.ts` — interfeys (`authenticate`, `getUser`). Hozir `SingleAccountProvider` ishlatiladi: bitta akkaunt, login va parol `.env` dan. Sessiya imzolangan cookie'da saqlanadi (`server/auth/session.ts`), serverda holat yo'q.

Ko'p foydalanuvchili tizimga o'tishda: bazadagi foydalanuvchilar jadvaliga tayanadigan yangi provayder yozib, `container.ts` dagi `createAuthProvider()` da almashtirish kifoya. Ma'lumotlarni foydalanuvchiga bog'lash uchun mahsulot va harakatlarga egasi (`ownerId`) maydoni qo'shiladi va `Repository` metodlariga uzatiladi.

## Uzum Market bilan bog'lanish

### Ulash

1. Uzum sotuvchi kabinetida **Sozlamalar → API kalitlari** bo'limidan kalit yarating.
2. `.env` fayliga yozing: `UZUM_API_KEY=kalitingiz`. Kalitni hech kimga yubormang.
3. Avval ulanishni tekshiring. Bu buyruq faqat o'qiydi, hech narsa yozmaydi:

```bash
npm run uzum:tekshir
```

Windows PowerShell "running scripts is disabled" desa, `npm` o'rniga `npm.cmd` yozing:

```powershell
npm.cmd run uzum:tekshir
```

4. Serverni qayta ishga tushiring. Ilova ishga tushganda va har 15 daqiqada Uzumdan yangilaydi. "Uzum" sahifasidagi **Hozir yangilash** tugmasi bilan qo'lda ham yangilash mumkin.
5. Har bir Uzum do'koni ilovada alohida do'kon bo'lib paydo bo'ladi. Do'konni tanlang → "Uzum" → **Hammasini import qilish**: kartochkalar rang, o'lcham va kodlari hamda Uzumdagi qoldig'i bilan keladi. Keyin omborimdagi sonlarni "Sanab tuzatish" bilan kiriting.

### Do'konlar

- Uzumdagi har bir do'kon (`GET /v1/shops`) ilovada alohida do'kon bo'ladi. Mahsulotlar, qoldiq, tarix va Uzum yozuvlari do'kon bo'yicha alohida yuritiladi.
- Kod (artikul) faqat bitta do'kon ichida takrorlanmas — ikki do'konda bir xil kod bo'lishi mumkin, ular aralashmaydi.
- Uzumga bog'lanmagan do'kon ham bo'lishi mumkin (masalan, eski versiyadan qolgan "Asosiy do'kon"). Unda jo'natish va sotuv qo'lda kiritiladi.
- Tanlangan do'kon telefonda eslab qolinadi.

### Nima avtomatik yoziladi

| Uzumda | Ilovada | Uzum API |
|---|---|---|
| Yetkazib berish nakladnoyi (FBO) yaratildi | **Uzumga jo'natdim**: omborim −, Uzum + (nakladnoydagi son) | `GET /v1/invoice` |
| Nakladnoy bekor qilindi | Yozuv bekor qilinadi (tarixda qoladi) | o'sha |
| Nakladnoydagi son o'zgardi | Eski yozuv bekor qilinib, yangisi yoziladi | o'sha |
| Sotuv (FBO) | **Sotildi**: Uzum − (bekor qilingan va xaridor qaytargan sonlar ayiriladi) | `GET /v1/finance/orders` |
| FBS/DBS buyurtma yaratildi | **Sotildi (FBS)**: **omborim −** (tovarni o'zingiz jo'natasiz) | `GET /v2/fbs/orders` (har bir holat bo'yicha) |
| FBS buyurtma bekor qilindi yoki qaytarildi | Yozuv bekor qilinadi — tovar omborga qaytadi | o'sha |
| Qaytarish nakladnoyi yakunlandi (tovar sizga topshirildi) | **Qaytdi**: omborim +, Uzum − | `GET /v1/return` |
| Katalog: SKU, artikul, Uzumdagi qoldiq | Bog'lash, import va "Uzum bilan farq" | `GET /v1/product/shop/{shopId}` |

Uzumdagi har bir hujjat qatori takrorlanmas kalit bilan saqlanadi, shuning uchun qayta yangilashda ikki marta yozilmaydi. Sotuv kaliti "buyurtma + SKU kodi": FBS buyurtma sotuvlar ro'yxatida ham ko'rinsa, bir marta — omborimdan — hisoblanadi. Avtomatik yozuvlar tarixda **Uzum** belgisi va hujjat raqami bilan ko'rinadi.

### Qanday taniydi

Ilovadagi variant artikuli Uzumdagi SKU artikuli (yoki sotuvchi kodi, yoki SKU nomi) bilan bir xil bo'lsa, ular avtomatik bog'lanadi. Katta-kichik harf farq qilmaydi. Mos kelmaganlar "Uzum" sahifasidagi **Bog'lanmagan Uzum mahsulotlari** ro'yxatida chiqadi:
- **Bog'lash** — ilovadagi mavjud variantni tanlaysiz;
- **Import qilish** — Uzum kartochkasi ilovaga variantlari, artikullari va Uzumdagi hozirgi qoldig'i bilan qo'shiladi. Omborimdagi sonni keyin "Sanab tuzatish" bilan kiritasiz.

Bog'langach, shu SKU'ni kutib turgan yozuvlar o'zi qo'llanadi.

### Qoldiq qoidalari saqlanadi

Uzumdan kelgan yozuv qoldiqni manfiy qiladigan bo'lsa (masalan, "Mahsulot keldi" kiritilmagan), u yozilmaydi va **Kutilmoqda** bo'lib turadi. Sababi va nima qilish kerakligi yozib qo'yiladi. Qoldiqni to'g'irlashingiz bilan (masalan, "Mahsulot keldi"ni kiritsangiz) u o'zi yoziladi. Avtomatik yozuvni qo'lda bekor qilsangiz, Uzumdan qayta yozilmaydi.

### Qaysi sanadan

Birinchi ulanishda shu kundan boshlab hisoblanadi. Eski hujjatlar boshlang'ich qoldiqqa kirgan deb olinadi va ikki marta hisoblanmaydi. Sanani "Uzum" sahifasida o'zgartirish mumkin.

### "Uzumda" soni Uzumnikidan farq qilsa

Mahsulot sahifasida variant yonida "Uzum: N ta — tuzatish" chiqadi. Bosilsa, Uzumdagi son "Sanab tuzatish" yozuvi sifatida olinadi va tarixda ko'rinadi. Farq odatda nakladnoy hali qabul qilinmaganda yoki Uzum ba'zi tovarni qabul qilmaganda bo'ladi.

### Haqiqiy Uzum ma'lumotlari bilan tekshirilgan

- Sotuvchi kabinetda ko'radigan to'liq SKU kodi (`DINAMUZ-JORDAN-БЕЖЕВ-L`) API'da `skuFullTitle` maydonida keladi. `skuTitle` maydonida faqat qisqa qismi (`БЕЖЕВ-L`) bo'ladi. `article` va `sellerItemCode` maydonlari bo'sh keladi. Shu sababli ilovadagi artikulni **Uzumdagi to'liq SKU kodi bilan bir xil** yozing.
- Nakladnoy tarkibidagi SKU `id` maydoni katalogdagi `skuId` bilan bir xil (100 qatordan 100 tasi mos).
- Nakladnoy sanasi `dd.MM.yyyy` formatida keladi. Qaytarish sanalari millisekundda keladi.
- Nakladnoy holatlari: `CREATED`, `ACCEPTED`. Qaytarish holati: `COMPLETED`.
- Xususiyatlar nomsiz keladi ("L, Sargʻish") — importda nomi qiymatdan taxmin qilinadi: o'lcham (S, M, L, XL, 42...), hajm (0.5l, 200ml...), qolgani — rang.
- FBS buyurtmalarini `/v2/fbs/orders` faqat holat (`status`) bilan qaytaradi — har bir holat alohida so'raladi.
- Uzum tez so'rovlarni cheklaydi (429) — mijoz so'rovlar orasida pauza qiladi va kutib qayta urinadi.
- Sotuvlar ro'yxati bir sahifada eng ko'pi 50 qator beradi.

Hali taxmin bo'lib qolgan qoidalar (o'zgartirish kerak bo'lsa, faqat `server/integrations/uzum/mapping.ts` o'zgaradi):
- Bekor qilingan nakladnoy holatida `CANCEL` so'zi bor.
- Omborimdan nakladnoy **yaratilganda** ayiriladi (`quantityToStock`), ya'ni tovar ombordan chiqib ketgan deb hisoblanadi.
- FBS buyurtma **yaratilganda** omborimdan ayiriladi (tovar sizga band). `CANCELED` yoki `RETURNED` bo'lsa — qaytadi.
- FBS turidagi qaytarish nakladnoylari alohida hisoblanmaydi (FBS buyurtmaning o'zida hisobga olinadi).

## Keyinchalik qo'shiladiganlar

Hali yo'q: shtrix-kod skaneri, Telegram bot, jamoa (ko'p foydalanuvchi), narx va foyda hisobi, "yo'lda" holati, hisobot grafiklari, omborimdagi qoldiqni Uzumdagi FBS qoldig'iga avtomatik yuborish (`POST /v2/fbs/sku/stocks`). Ular uchun joy tayyor:

- Yangi harakat turi (masalan, "yo'lda") — `domain/types.ts` dagi `MovementType` va `domain/stock.ts` dagi `movementEffect` ga qo'shiladi; qolgan hisob-kitob o'zi ishlaydi.
- Telegram bot — `InventoryService` ni chaqiradigan yangi kirish nuqtasi (`server/http` yonida), biznes qoidalari takrorlanmaydi.
- Boshqa marketpleys — `server/integrations/` ichida Uzumga o'xshash mijoz va `mapping`; hodisa va qoidalar mexanizmi umumiy.
- Hisobotlar — `listMovements` natijasidan sof funksiyalar bilan hisoblanadi.

# TECHNITEX – Live Event Scoreboard

இந்த project-ல் scoreboard UI, Express API, PostgreSQL database ஆகியவை உள்ளன. Vercel-ன் Express deployment முறைக்கு root-இல் உள்ள `server.js` ஒரே app entry point ஆகப் பயன்படுகிறது; `public/index.html` homepage ஆகும். UI-ஐ மாற்றவில்லை.

## GitHub-க்கு upload செய்வது

1. ZIP-ஐ unzip செய்யவும். `technitex-deploy` folder-க்குள் `package.json`, `server.js`, `lib/`, `public/` இருக்க வேண்டும்.
2. GitHub repository-யில் இந்த project-இன் உள்ளடக்கங்களை upload செய்யவும். `.env` அல்லது உண்மையான passwords/secrets-ஐ upload செய்ய வேண்டாம்; `.env` Git-ல் சேராமல் தடுக்கப்பட்டுள்ளது.
3. ZIP-ல் உள்ள folder-ஐ அப்படியே repository-க்கு upload செய்தால், Vercel Project → Settings → Build and Deployment → Root Directory-ல் `technitex-deploy` என்று அமைக்கவும். அதன் உள்ளடக்கங்களையே repository root-ல் வைத்தால் Root Directory-ஐ `./` ஆக விடவும்.

## Vercel deployment

1. Vercel-ல் **Add New → Project** தேர்ந்தெடுத்து GitHub repository-ஐ Import செய்யவும். Framework Preset `Express` ஆகத் தேர்ந்தெடுக்கவும் அல்லது Vercel தானாகக் கண்டறிவதை ஏற்கவும்.
2. Project Root Directory சரியாக உள்ளதா உறுதிப்படுத்தவும். Build Command மற்றும் Output Directory-க்கு தனிப்பயன் மதிப்பு வேண்டாம்; `server.js` Express entry point-ஐ Vercel கண்டறியும்.
3. Settings → Environment Variables-ல் Production-க்கு இவற்றைச் சேர்க்கவும்:
   - `DATABASE_URL`: PostgreSQL provider கொடுக்கும் connection string. Vercel-இலிருந்து database-ஐ அணுக அனுமதி வேண்டும்.
   - `JWT_SECRET`: குறைந்தது 32 எழுத்துகள் கொண்ட சீரற்ற secret.
   - `ADMIN_USER`: நிர்வாகி login பெயர்.
   - `ADMIN_PASSWORD`: வலுவான நிர்வாகி password.
4. **Deploy** அழுத்தவும். Deployment முடிந்ததும் `https://உங்கள்-domain.vercel.app/` திறந்து homepage-ஐப் பார்க்கவும். `/api/health`-ல் `{"status":"ok"}` வந்தால் API மற்றும் database இரண்டும் தயாராக உள்ளன.
5. GitHub-க்கு புதிய commit/push செய்தால் Vercel மீண்டும் deploy செய்யும்.

`/api/health` தரவுத்தளத்தையும் சரிபார்க்கிறது. அது தோல்வியடைந்தால் Vercel Environment Variables, PostgreSQL connection string, database provider-இன் network access ஆகியவற்றைச் சரிபார்க்கவும். Database மற்றும் secrets இல்லாமல் API செயல்படாது.

## Local run

Node.js 20.12 அல்லது அதற்கு மேல் நிறுவிய பிறகு, project folder-ல்:

```bash
npm install
```

`.env.example`-ஐ `.env` என்று நகலெடுத்து உண்மையான database URL, JWT secret, admin username/password நிரப்பவும். பிறகு:

```bash
npm run check
npm start
```

`http://localhost:3000` திறக்கவும். `.env`-ஐ GitHub-க்கு commit செய்ய வேண்டாம்.

## முக்கிய கோப்புகள்

- `public/index.html` – முன்னிருந்த scoreboard UI
- `server.js` – local server; Vercel Express app entry point
- `lib/app.js` – API routes மற்றும் PostgreSQL செயல்பாடுகள்
- `.env.example` – local environment variable மாதிரி; உண்மையான secrets இல்லை

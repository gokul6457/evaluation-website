// Local development server:  npm start  ->  http://localhost:3000
const path = require('path'), express = require('express');
try { process.loadEnvFile(path.join(__dirname, '.env')) } catch {}
const app = require('./lib/app');
const web = express();
web.use(app);
web.use(express.static(path.join(__dirname, 'public')));
web.listen(process.env.PORT || 3000, () => console.log('TECHNITEX running on http://localhost:' + (process.env.PORT || 3000)));

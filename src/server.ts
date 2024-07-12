import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import express, { Request, Response, NextFunction } from 'express';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import { google } from 'googleapis';
import passport from 'passport';
import mongoose from 'mongoose';
import cron from 'node-cron';
import dotenv from 'dotenv';
import pdf from 'pdf-parse';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import bodyParser from 'body-parser';
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';

dotenv.config();

const app = express();

// Configuration
const PORT = parseInt(process.env.PORT || '10000', 10);
const MONGODB_URI = process.env.MONGODB_URI as string;
const SESSION_SECRET = process.env.SESSION_SECRET as string;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET as string;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID as string;
const RANGE = process.env.RANGE as string;
const TARGET_SPREADSHEET_ID = process.env.TARGET_SPREADSHEET_ID as string;
const TARGET_RANGE = process.env.TARGET_RANGE as string;
const CALLBACK_URL = 'http://localhost:3000/auth/google/callback';
const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LAST_FETCHED_ROW_INDEX_FILE = './src/lastFetchedRowIndex.txt';

// Initialize MongoDB connection and user model
initializeDatabase();
const User = createUserModel();

// Middleware
configureMiddleware(app);

// Passport configuration
configurePassport();

// Routes
configureRoutes(app);

// Error handling middleware
app.use(errorHandler);

// Configure CORS
app.use(cors({
  origin: 'http://localhost:5173', // Replace with the origin of your client-side application
  credentials: true
}));

// Serve the HTML form from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Section: Database Initialization
function initializeDatabase() {
  mongoose.connect(MONGODB_URI);
}

function createUserModel() {
  const userSchema = new mongoose.Schema({
    googleId: String,
    accessToken: String,
    refreshToken: String,
    accessTokenExpiry: Date,
  });
  return mongoose.model('User', userSchema);
}

// Section: Middleware Configuration
function configureMiddleware(app: express.Express) {
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(bodyParser.json());
  app.use(refreshTokenMiddleware);
}

// Section: Passport Configuration
function configurePassport() {
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['profile', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      const expiryDate = new Date(Date.now() + 3600 * 1000);
      if (user) {
        user.accessToken = accessToken;
        user.refreshToken = refreshToken;
        user.accessTokenExpiry = expiryDate;
        await user.save();
      } else {
        user = new User({
          googleId: profile.id,
          accessToken,
          refreshToken,
          accessTokenExpiry: expiryDate,
        });
        await user.save();
      }
      done(null, user);
    } catch (error) {
      done(error);
    }
  }));
}

// Section: Routes Configuration
function configureRoutes(app: express.Express) {
  app.get('/', (req: Request, res: Response) => {
    res.sendFile("index.html", {root: "public"});
  });
  
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], accessType: 'offline', prompt: 'consent' }));
  
  app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
  });
  
  app.get('/isAuthenticated', checkAuthentication);
  
  app.get('/logout', (req: Request, res: Response, next: NextFunction) => { 
    req.logout((err) => { 
      if (err) return next(err); 
      res.redirect('/'); 
    }); 
  });

  // Route to bypass login for end-users
  app.get('/bypass-login', bypassLogin);
  app.post('/update-env', updateEnv);
}

// Function to fetch the last fetched row index from the file
function getLastFetchedRowIndex(): number {
  try {
    if (fs.existsSync(LAST_FETCHED_ROW_INDEX_FILE)) {
      const data = fs.readFileSync(LAST_FETCHED_ROW_INDEX_FILE, 'utf8');
      return parseInt(data, 10);
    }
  } catch (err) {
    console.error('Failed to read last fetched row index file', err);
  }
  return 0;
}

// Function to save the last fetched row index to the file
function saveLastFetchedRowIndex(index: number): void {
  try {
    fs.writeFileSync(LAST_FETCHED_ROW_INDEX_FILE, index.toString(), 'utf8');
  } catch (err) {
    console.error('Failed to write last fetched row index file', err);
  }
}

let lastFetchedRowIndex = getLastFetchedRowIndex();

// Function to fetch data from Google Sheets and display as JSON
async function fetchSpreadsheets() {
  try {
    const spreadsheetId = SPREADSHEET_ID;
    const range = RANGE;

    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
    const user = await User.findOne(); // Assuming a single user for simplicity
    if (!user) throw new Error('User not found');

    oauth2Client.setCredentials({ access_token: user.accessToken });

    const sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });

    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: range,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log('No data found.');
      return;
    }

    const newRows = rows.slice(lastFetchedRowIndex + 1);

    if (newRows.length === 0) {
      console.log('No new rows found.');
      return;
    }

    const headers = rows[0];
    const jsonData = newRows.map(row => {
      const obj: { [key: string]: any } = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });

    lastFetchedRowIndex = rows.length - 1;
    saveLastFetchedRowIndex(lastFetchedRowIndex);

    return jsonData;
  } catch (error) {
    console.error('Failed to fetch spreadsheets', error);
  }
}

// Function to fetch file from Google Drive and display as JSON
async function fetchDriveFile() {
  const fileId = process.env.FILE_ID;

  try {
    const user = await User.findOne(); // Assuming a single user for simplicity
    if (!user) throw new Error('User not found');

    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
    oauth2Client.setCredentials({ access_token: user.accessToken });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const response: any = await drive.files.get({
      fileId: fileId,
      alt: 'media',
    }, { responseType: 'arraybuffer' });

    const pdfData = await pdf(response.data);

    console.log(pdfData.text);
  } catch (error) {
    console.error('Failed to fetch file from Drive', error);
  }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const systemContext: string = `
Ответь как всемирно известный эксперт в области IT-рекрутинга с престижной наградой за достижения в подборе кадров.

Твоя задача — отбор кандидатов на курс, требующий определённого уровня знаний и опыта в IT сфере. Вот улучшенная версия твоего запроса:

Ты HR менеджер, ответственный за отбор кандидатов на курс, который требует от участников определённого уровня знаний и опыта в IT сфере. Твоя задача - проверять кандидатов на соответствие следующим критериям:

1) Основные знания фронтенд и/или бэкенд разработки:

Кандидат должен уверенно владеть базовыми принципами и технологиями, используемыми во фронтенд и/или бэкенд разработках.
Примеры необходимых знаний: HTML, CSS, JavaScript для фронтенда; базовые знания серверных языков программирования и работы с базами данных для бэкенда.

2) Опыт работы с фреймворками:

Кандидат должен иметь базовые знания и опыт работы хотя бы с одним из основных фреймворков:
Фронтенд: React, Vue, Angular и другие.
Бэкенд: FastAPI, Django, Flask, Node.js и другие.
Если кандидат владеет хотя бы одним из направлений (фронтенд или бэкенд) на нормальном уровне, он соответствует требованиям.

3) Активное вовлечение в IT сферу:

Убедись, что кандидат активно вовлечён в IT сферу. Это может быть текущая работа в IT компании, участие в проектах, написание кода, участие в хакатонах и т.д.
Проверь портфолио кандидата или его участие в сообществах разработчиков.

4) Пребывание в Алматы:

Кандидат должен иметь возможность физически находиться в Алматы до 9 августа. Это требование важно для участия в очных мероприятиях или встречах, которые планируются в рамках курса.

5) Наличие GitHub аккаунта:

Кандидат обязан иметь GitHub аккаунт.

Если кандидат соответствует всем вышеуказанным требованиям, его заявка будет принята. Если возникают сомнения, рекомендуется консультация с ментором, но это не рекомендуется.

Ваш ответ должен представлять собой объект JSON, содержащий 3 атрибута:

{
  "candidate_tg": "Телеграм кандидата для связи",
  "summary": "Краткий вывод заявки кандидата, причина принятия или не принятия на курс",
  "decision": "Соответствует требованиям" или "Нужна дополнительная проверка ментором" или "Не соответствует требованиям"
}

Пожалуйста, обеспечь строгий отбор, чтобы слабые кандидаты не проходили.
`;

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-pro',
  systemInstruction: systemContext,
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ],
});

async function gemini() {
  const candidates = await fetchSpreadsheets();

  if (candidates === undefined) {
    console.log('No candidates found.');
    return;
  }

  try {
    async function processCandidatesOneByOne(candidates: any, delayMs: any) {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];

        try {
          const result = await model.generateContent(JSON.stringify(candidate));
          const response = result.response.text();

          const beginIndex = response.indexOf('{');
          const lastIndex = response.indexOf('}');

          const parsedResult = JSON.parse(
            response.substring(beginIndex, lastIndex + 1)
          );
          console.log(parsedResult);

          // Adding JSON to spreadsheet
          await addJSONToSpreadsheet(parsedResult);
        } catch (e) {
          console.log(e);
        }

        await delay(delayMs);
      }
    }

    processCandidatesOneByOne(candidates, 20000);
  } catch (e: any) {
    console.log(e);
  }
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAccessToken(user: any) {
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
  oauth2Client.setCredentials({ refresh_token: user.refreshToken });

  try {
    const tokenResponse = await oauth2Client.getAccessToken();
    user.accessToken = tokenResponse.token;
    user.accessTokenExpiry = new Date(Date.now() + 3600 * 1000);
    await user.save();
    console.log(`Access token refreshed: ${user.accessToken}`);
  } catch (error) {
    console.error('Failed to refresh access token', error);
  }
}

async function refreshTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    const user = req.user as any;
    if (user.accessToken && new Date() > new Date(user.accessTokenExpiry)) {
      await refreshAccessToken(user);
    }
  }
  next();
}

// Section: Error Handling
function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error(err.stack);
  res.status(500).send('Something broke!');
}

function checkAuthentication(req: Request, res: Response) {
  if (req.isAuthenticated()) {
    res.status(200).json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
}

// New function to add JSON data to a new spreadsheet
async function addJSONToSpreadsheet(data: any) {
  try {
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
    const user = await User.findOne(); // Assuming a single user for simplicity
    if (!user) throw new Error('User not found');

    oauth2Client.setCredentials({ access_token: user.accessToken });

    const sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });

    const range = TARGET_RANGE;

    const values = [
      Object.values(data)
    ];

    const resource = {
      values,
    };

    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: TARGET_SPREADSHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: resource,
    });

    console.log('Data added to spreadsheet');
  } catch (error) {
    console.error('Failed to add data to spreadsheet', error);
  }
}

// Schedule tasks to run every minute
cron.schedule('* * * * *', async () => {
  await gemini();
});

// Function to update the .env file
function updateEnv(req: Request, res: Response) {
  const { spreadsheetId, range, targetSpreadsheetId, targetRange, lastFetchedRow } = req.body;
  
  process.env.SPREADSHEET_ID = spreadsheetId;
  process.env.RANGE = range;
  process.env.TARGET_SPREADSHEET_ID = targetSpreadsheetId;
  process.env.TARGET_RANGE = targetRange;

  res.status(200).send('Environment variables updated successfully');
}

// Function to handle login bypass
async function bypassLogin(req: Request, res: Response) {
  try {
    const adminUser = await User.findOne(); // Assuming a single user for simplicity
    if (adminUser) {
      req.login(adminUser, (err) => {
        if (err) {
          console.error('Failed to login admin user', err);
          return res.status(500).send('Failed to login');
        }
        return res.redirect('/');
      });
    } else {
      res.status(500).send('Admin user not found');
    }
  } catch (error) {
    console.error('Error in bypass-login route', error);
    res.status(500).send('Internal Server Error');
  }
}

// Schedule token refresh task to run every hour
cron.schedule('0 * * * *', async () => {
  const users = await User.find();
  for (const user of users) {
    await refreshAccessToken(user);
  }
});

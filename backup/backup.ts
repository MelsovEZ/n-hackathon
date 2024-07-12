import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import express, { Request, Response, NextFunction } from 'express';
import { google, gmail_v1 } from 'googleapis';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import passport from 'passport';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI as string;
const SESSION_SECRET = process.env.SESSION_SECRET as string;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET as string;
const CALLBACK_URL = 'http://localhost:3000/auth/google/callback';

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Section: Database Initialization
function initializeDatabase() {
  mongoose.connect(MONGODB_URI);
}

function createUserModel() {
  const userSchema = new mongoose.Schema({
    googleId: String,
    displayName: String,
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
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      const expiryDate = new Date(Date.now() + 3600 * 1000);
      if (user) {
        user.accessToken = accessToken;
        user.refreshToken = refreshToken;
        user.displayName = profile.displayName;
        user.accessTokenExpiry = expiryDate;
        await user.save();
      } else {
        user = new User({
          googleId: profile.id,
          displayName: profile.displayName,
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
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly'], accessType: 'offline', prompt: 'consent' }));
  app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/');
  });
  app.get('/logout', (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
  });
  app.get('/', async (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user as any;
      res.send(`Hello, ${user.displayName}.<br />Your access token is: ${user.accessToken}`);
    } else {
      res.send('Hello, Guest. Please <a href="/auth/google">login with Google</a>.');
    }
  });
  app.get('/emails', fetchEmails);
  app.get('/email/:id', fetchEmailById);
  app.get('/isAuthenticated', checkAuthentication);
}

// Section: Email Fetching Functions
async function fetchEmails(req: Request, res: Response) {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Unauthorized');
    }

    const user = req.user as any;
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
    oauth2Client.setCredentials({ access_token: user.accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
    });

    const messages = response.data.messages;

    if (messages) {
      const emails = await Promise.all(
        messages.map(async (email) => {
          if (email.id) {
            const message = await gmail.users.messages.get({ userId: 'me', id: email.id });
            const body = getBody(message.data);
            return {
              id: email.id,
              subject: message.data.payload?.headers?.find(header => header.name === 'Subject')?.value,
              snippet: message.data.snippet,
              body,
            };
          }
          return null;
        })
      );

      res.json(emails.filter(email => email !== null));
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).send('Error fetching emails');
  }
}

async function fetchEmailById(req: Request, res: Response) {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).send('Unauthorized');
    }

    const user = req.user as any;
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
    oauth2Client.setCredentials({ access_token: user.accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const emailId = req.params.id;

    const message = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
    });

    const body = getBody(message.data);

    const email = {
      id: emailId,
      subject: message.data.payload?.headers?.find(header => header.name === 'Subject')?.value,
      snippet: message.data.snippet,
      body,
    };

    res.json(email);
  } catch (error) {
    console.error('Error fetching email:', error);
    res.status(500).send('Error fetching email');
  }
}

// Section: Utility Functions
function getBody(message: gmail_v1.Schema$Message): string {
  const encodedBody = getPart(message.payload, 'text/html');
  return encodedBody ? Buffer.from(encodedBody, 'base64').toString('utf-8') : 'No body found';
}

function getPart(payload: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string | null {
  let body = null;
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === mimeType) {
        body = part.body?.data || null;
        break;
      } else if (part.parts) {
        body = getPart(part, mimeType);
        if (body) break;
      }
    }
  } else if (payload?.body?.data) {
    body = payload.body.data;
  }
  return body;
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

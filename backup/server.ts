import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const systemContext: string = `
Ты HR менеджер, ответственный за отбор кандидатов на курс, который требует от участников определённого уровня знаний и опыта в IT сфере. Твоя задача - проверять кандидатов на соответствие следующим критериям:

1)Знание основ фронтенд и бэкенд разработок:

Кандидат должен уверенно владеть базовыми принципами и технологиями, используемыми как во фронтенд, так и в бэкенд разработках.
Примеры необходимых знаний: HTML, CSS, JavaScript для фронтенда; базовые знания серверных языков программирования и работы с базами данных для бэкенда.
Опыт работы в IT сфере:

2)Кандидат должен иметь опыт в верстке сайтов и разработке веб-приложений.
Убедись, что кандидат имеет практический опыт, а не только теоретические знания.
Знание фреймворков:

3)Кандидат должен иметь базовые знания и опыт работы хотя бы с одним из основных фреймворков, такими как:
Фронтенд: React, Vue, Angular и другие.
Бэкенд: FastAPI, Django, Flask, node.js и другие.
Проверь, что кандидат понимает, как использовать эти фреймворки в проектах.
При этом, если кандидат знает на нормальном уровне хотя бы один из двух (фронтенд или бэкенд), то кандидат соответствует требованиям.

4)Связь с IT сферой:

Убедись, что кандидат активно вовлечён в IT сферу. Это может быть текущая работа в IT компании, участие в проектах, написание кода, участие в хакатонах и т.д.
Посмотри на портфолио кандидата или его участие в сообществах разработчиков.

5)Пребывание в Алматы:

Кандидат должен иметь возможность физически находиться в Алматы до 9 августа.
Это требование важно для участия в очных мероприятиях или встречах, которые планируются в рамках курса.

6)Наличие GitHub аккаунта:

Кандидат обязан иметь GitHub аккаунт

Ваш ответ должен представлять собой объект JSON({decision: string, summary: string}), содержащий 2 атрибута. Объект имеет следующую схему:

{
  Decision: Ты должен указать, подходит ли кандидат на курс или нет. Если подходит, то укажи "Соответсвует требованиям", если нет - "Не соответствует требованиям. Требуется проверка ментора".
  Summary: Ты должен предоставить краткий вывод заявки кандидата, причина принятия или не принятия на курс.
}

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(){
  const data = fs.readFileSync('src/List1.json', 'utf8');
  const candidates = JSON.parse(data);

  try {
    async function processCandidatesOneByOne(candidates: any, delayMs: any) {
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];

        try {
          const result = await model.generateContent(JSON.stringify(candidate));
          const response = result.response.text();

          const beginIndex = response.indexOf('{');
          const lastIndex = response.indexOf('}');

          // console.log(result.response.text());

          const parsedResult = JSON.parse(
            response.substring(beginIndex, lastIndex + 1)
          );
          console.log(parsedResult);
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

run();

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send({ serverStatus: 'UP' });
});

const PORT: string | number = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on PORT: ${PORT}`);
});

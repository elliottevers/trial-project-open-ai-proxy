const express = require('express');
const cors = require('cors');
import { Request, Response } from 'express';
const { OpenAI } = require('openai');

const openai = new OpenAI();

const app = express().use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', cors());

const PORT = 3001;

app.use(express.json());

interface GenerateQuestionRequest {
  domain: string;
  seenWords: string[];
}

type OpenAIGeneratedQuestionResponse = GeneratedQuestionSuccess | GeneratedQuestionFailure;

interface GeneratedQuestionSuccess {
  word: string;
  definition: string;
  multipleChoiceSiblingDefinitions: string[];
  exampleUsages: string[];
}

interface GeneratedQuestionFailure {
  message: string;
}

interface OpenAIScoreUserAnswerRequest {
  domain: string;
  word: string;
  userAnswer: string;
}

type OpenAIScoredUserAnswerResponse = OpenAIScoredUserAnswerSuccess | OpenAIScoredUserAnswerFailure;

interface OpenAIScoredUserAnswerSuccess {
  score: number
}

interface OpenAIScoredUserAnswerFailure {
  message: string
}

function renderTemplate(template: string, data: Record<string, string | string[]>): string {
  return template.replace(/\$\{\s*([^}]+)\s*\}/g, (_, key) => {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value ?? `\${${key}}`; // Leave placeholder if no value provided
  });
}

const generateQuestionTemplate = (domain, seenWords) => `

We are using this conversation as the backbone of a vocabulary acquisition app. You are going to be indefinitely generating me a set of words, exactly one word per message, in the domain of ${domain}.

I am providing you a tool that you need to supply a set of 4 arguments to.  You must always call this tool.

Words you will not generate include the set (${JSON.stringify(seenWords)}).
`;

const templateScoreUserAnswer = `
You are scoring a definition provided by a student of a term in the domain of \${domain}. The result will be in the format of a score between 0 and 1. The result will be returned in a JSON format in the following form:

interface OpenAIScoringResponse {
  similarityScore: number;
}

The word is \${word}.

The provided definition is: \${userAnswer}

You are *never* to return me an answer that is not pure JSON.  You only answer in the JSON format provided.

Your response must be valid JSON. Do not include any text before or after the JSON object.
`;

const toolsGenerateQuestion = [
  {
    type: "function",
    function: {
      "name": "generate_vocabulary_word",
      "description": "Generates a word, its definition, sibling definitions, and example usages in JSON format for vocabulary acquisition.",
      "parameters": {
        "type": "object",
        "properties": {
          "word": {
            "type": "string",
            "description": "The vocabulary word being generated."
          },
          "definition": {
            "type": "string",
            "description": "The definition of the word.  The word itself must not be included in this."
          },
          "multipleChoiceSiblingDefinitions": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Definitions of similar terms that might confuse a beginner.  The word being defined must not be included in the string.  Do not put the word being defined at the beginning of the string."
          },
          "exampleUsages": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Three example sentences that demonstrate the word’s usage."
          }
        },
        "required": [
          "word",
          "definition",
          "multipleChoiceSiblingDefinitions",
          "exampleUsages"
        ]
      }
    }
  }
]

app.get('/health', (req: Request, res: Response) => {
  res.status(200).send({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/generateQuestion', async (req: Request<{}, {}, GenerateQuestionRequest>, res: Response<OpenAIGeneratedQuestionResponse>) => {
  try {
    const {domain, seenWords} = req.body;

    const content = generateQuestionTemplate(domain, seenWords)

    // NB: trying the function calling API for the heck of it
    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content,
        },
      ],
      model: "gpt-4o",
      tools: toolsGenerateQuestion
    })

    // res.send(JSON.parse(response.choices[0].message.content));

    res.send(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments))

  } catch (error) {
    console.error(error.message);
    res.status(500).send({ message: `Error generating question: ${error.message}` });
  }
});

app.post('/scoreUserAnswer', async (req: Request<{}, {}, OpenAIScoreUserAnswerRequest>, res: Response<OpenAIScoredUserAnswerResponse>) => {
  try {
    const {domain, word, userAnswer} = req.body;

    const content = renderTemplate(templateScoreUserAnswer, {
      domain,
      word,
      userAnswer
    });

    const chatCompletion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content
          }
        ],
        model: "gpt-4o",
      });

    res.send(JSON.parse(chatCompletion.choices[0].message.content));

  } catch (error) {
    console.error(error.message);
    res.status(500).send({ message: `Error scoring user answer: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

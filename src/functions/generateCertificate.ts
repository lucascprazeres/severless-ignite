import { S3 } from "aws-sdk";
import * as chromium from "chrome-aws-lambda";
import * as dayjs from "dayjs";
import { readFileSync } from "fs";
import * as path from "path";
import * as handlebars from "handlebars";
import { document } from "../utils/dynamodbClient";

interface IGenerateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async (data: ITemplate) => {
  const filePath = path.resolve(process.cwd(), "src", "template", "certificate.hbs");

  const html = readFileSync(filePath, "utf-8");

  return handlebars.compile(html)(data);
}

export const handle = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as IGenerateCertificate;

  const response = await document.query({
    TableName: "users_certificates",
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: {
      ":id": id
    }
  }).promise();

  const userCertificate = response.Items[0];

  if (!userCertificate) {
    await document.put({
      TableName: "users_certificates",
      Item: {
        id,
        name,
        grade
      }
    }).promise();
  }

  const medalPath = path.join(process.cwd(), "src", "templates", "selo.png");
  const medal = readFileSync(medalPath, "base64");
  
  const data: ITemplate = {
    date: dayjs().format("DD/MM/YYYY"),
    grade,
    name,
    id,
    medal, 
  }

  const content = await compile(data);

  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
    format: 'a4',
    landscape: true,
    path: process.env.IS_OFFLINE ? "certificate.pdf" : null,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  const s3 = new S3();

  await s3.putObject({
    Bucket: "serverlesscertificatesignite",
    Key: `${id}.pdf`,
    ACL: "public-read",
    Body: pdf,
    ContentType: "application/pdf"
  }).promise();

  return {
    statusCode: 201,
    body:
      JSON.stringify({
        message: "Well done! Certificate created."
      }),
    headers: {
      "Content-type": "application/json"
    }
  }
}
const PDFDocument = require('pdfkit');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

axiosRetry(axios, { retries: 10, retryDelay: (count) => count * 300 });

const fs = require('fs');

async function createPdfFromImages(imageUrls, outputPath) {
  try {
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: 'B4',
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    for (const imageUrl of imageUrls) {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(response.data, 'binary');
      const img = doc.openImage(imageBuffer);

      doc.addPage().image(img, 0, 0, { width: doc.page.width });
    }

    doc.end();
    writeStream.on('finish', () => {
      console.log(`PDF successfully created at: ${outputPath}`);
    });
    writeStream.on('error', () => {
      console.log('Failed to writestream: ', outputPath);
    });
  } catch (e) {
    fs.rmSync(outputPath);
    console.log('Failed to: ', outputPath);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function extractBetweenStrings(str, startString, endString) {
  // Get the starting index after the startString
  const startIndex = str.indexOf(startString) + startString.length;

  // Get the ending index before the endString
  const endIndex = str.indexOf(endString, startIndex);

  // Check if both strings are found
  if (startIndex < startString.length || endIndex === -1) {
    return ''; // Return an empty string if not found
  }

  // Extract the substring and trim whitespace
  return str.substring(startIndex, endIndex).trim();
}

async function mangaMetadata(mangaName) {
  const webPage = `https://mangasee123.com/read-online/${mangaName}-chapter-1-page-1.html`;
  const sourceCode = await axios.get(webPage);

  const chapters = JSON.parse(extractBetweenStrings(sourceCode.data, 'vm.CHAPTERS = ', ';'))
    .map((chapter) => {
      return {
        ...chapter,
        Chapter: Number(chapter.Chapter.slice(1, -1)),
      };
    })
    .sort((a, b) => a.Chapter - b.Chapter);

  return {
    imagesCdn: extractBetweenStrings(sourceCode.data, 'vm.CurPathName = "', '";'),
    chapters,
  };
}

function generateImagesPathForChapter(mangaName, imagesCdn, chapterNumber, amountOfPages) {
  const images = [];

  for (let page = 1; page <= amountOfPages; page++) {
    const chapterNumberPadded = chapterNumber.toString().padStart(4, '0');
    const pageNumberPadded = page.toString().padStart(3, '0');
    images.push(`https://${imagesCdn}/manga/${mangaName}/${chapterNumberPadded}-${pageNumberPadded}.png`);
  }

  return images;
}

async function download(mangaName, chapterStart, chapterEnd) {
  const metadata = await mangaMetadata(mangaName);

  if (!fs.existsSync(`mangas/${mangaName}`)) {
    fs.mkdirSync(`mangas/${mangaName}`);
  }

  if (!chapterStart) {
    chapterStart = 1;
  }

  if (!chapterEnd) {
    chapterEnd = chapterStart;
  }

  if (chapterEnd > metadata.chapters[metadata.chapters.length - 1].Chapter) {
    chapterEnd = metadata.chapters[metadata.chapters.length - 1].Chapter;
  }

  if (chapterStart > chapterEnd) {
    console.log('chapter start cannot be bigger than chapter end', { chapterStart, chapterEnd });
    return;
  }

  // build batch of images path
  let batchOfImagesPath = [];
  for (let chapterNumber = chapterStart; chapterNumber <= chapterEnd; chapterNumber++) {
    const chapter = metadata.chapters.find((chapter) => chapter.Chapter == chapterNumber);
    if (chapter) {
      batchOfImagesPath = batchOfImagesPath.concat(
        generateImagesPathForChapter(mangaName, metadata.imagesCdn, chapterNumber, chapter.Page)
      );
    } else {
      console.log('chapter not found:', chapterNumber);
    }
  }

  const pdfPath = `mangas/${mangaName}/${mangaName}-Batch-${chapterStart}-${chapterEnd}.pdf`;

  // Check if the PDF file already exists
  if (fs.existsSync(pdfPath)) {
    console.log('skipping: ', pdfPath);
    return;
  }

  await createPdfFromImages(batchOfImagesPath, pdfPath);
}

(async () => {
  const argv = require('minimist')(process.argv.slice(2));
  if (!argv.name) {
    console.log('🚨 Provide --name= argument');
    return;
  }

  let sizeBatch = argv.size || 1;
  let startAt = argv.chapter || 1;
  let amount = (argv.amount || startAt) - 1;
  for (let i = 0; i <= amount; i++) {
    const computeStart = startAt + i * sizeBatch;
    const computeEnd = startAt + (i * sizeBatch + (sizeBatch - 1));
    if (argv.log) {
      console.log({ name: argv.name, computeStart, computeEnd });
    } else {
      await download(argv.name, computeStart, computeEnd);
    }
  }
})();

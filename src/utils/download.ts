import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";

const SERVICE_URL = "https://pdf-generator-api-z5z6k2buaq-de.a.run.app";

export const downloadPDF = async (urls: string[]) => {
  const response = await fetch(`${SERVICE_URL}/api/download`, {
    method: "POST",
    body: JSON.stringify({ urls }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  //   console.log("Response", await response.json());

  // Response blob is a zip file containing the pdfs, unzip and store in data/files/pdfs
  const zip = await response.blob();
  const zipArrayBuffer = await zip.arrayBuffer();
  const zipBuffer = Buffer.from(zipArrayBuffer);

  // Create the target directory if it doesn't exist
  const pdfDir = path.join(process.cwd(), "data", "files", "pdfs");
  await fs.promises.mkdir(pdfDir, { recursive: true });

  // Extract all PDF files from the zip
  const zipFile = new AdmZip(zipBuffer);
  const zipEntries = zipFile.getEntries();

  for (const entry of zipEntries) {
    if (entry.entryName.toLowerCase().endsWith(".pdf")) {
      const pdfBuffer = entry.getData();
      const pdfPath = path.join(pdfDir, entry.entryName);

      // Ensure the subdirectory exists if the PDF is in a subfolder
      const pdfDirPath = path.dirname(pdfPath);
      await fs.promises.mkdir(pdfDirPath, { recursive: true });

      // Write the PDF file
      await fs.promises.writeFile(pdfPath, pdfBuffer);
      console.log(`Extracted PDF: ${entry.entryName}`);
    }
  }

  console.log(
    `Extracted ${
      zipEntries.filter((entry) =>
        entry.entryName.toLowerCase().endsWith(".pdf")
      ).length
    } PDF files to ${pdfDir}`
  );
};

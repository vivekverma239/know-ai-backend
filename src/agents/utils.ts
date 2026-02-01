import { getDb } from "@/db";
import { userFile, userFilePage } from "@/db/schema";
import { getStorage } from "@/service/googleStorage";
import { and, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";

const db = getDb();

export const getSubPDFFn = (fileId: string, userId: string) => {
  const getSubPDF = async (pages: number[]) => {
    const obj = await getStorage().downloadFile(`files/${userId}/${fileId}/${fileId}.pdf`);
    if (!obj) {
      throw new Error(`PDF not found: ${fileId}`);
    }
    const srcDoc = await PDFDocument.load(obj);
    const newDoc = await PDFDocument.create();
    const zeroBasedPageIndices = pages.map((p) => p - 1);
    const copiedPages = await newDoc.copyPages(srcDoc, zeroBasedPageIndices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }
    const newPdfBytes = await newDoc.save();
    return Buffer.from(newPdfBytes);
  };
  return getSubPDF;
};

export const getPageContentFn = (fileId: string, userId: string) => {
  const getPageContent = async (pages: number[]) => {
    const filePages = await db
      .select({
        pageNumber: userFilePage.pageNumber,
        content: userFilePage.content,
      })
      .from(userFilePage)
      .innerJoin(userFile, eq(userFilePage.fileId, userFile.id))
      .where(
        and(
          eq(userFile.userId, userId),
          eq(userFilePage.fileId, fileId),
          inArray(userFilePage.pageNumber, pages),
        ),
      );
    return filePages.map((page: { pageNumber: number; content: string }) => ({
      pageNumber: page.pageNumber,
      content: page.content,
    }));
  };
  return getPageContent;
};

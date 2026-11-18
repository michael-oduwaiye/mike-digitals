
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  AlignmentType,
} = require("docx");

const FORMATS = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function cleanValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (value instanceof Date) {
    return value.toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
    });
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function safeFilename(value) {
  return String(value || "report")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createCsv(title, columns, rows, summary = []) {
  const escape = (value) => {
    let text = cleanValue(value);

    // Prevent spreadsheet formula injection.
    if (
      typeof value !== "number" &&
      /^[\s]*[=+\-@]/.test(text)
    ) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const report = [
    ["MIKE DIGITALS"],
    [title],
    [
      `Generated: ${new Date().toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
      })}`,
    ],
    ["Business: Mike Digitals"],
    ...summary.map((item) => [item.label, item.value]),
    [],
    columns.map((column) => column.header),
    ...rows.map((row) =>
      columns.map((column) => row[column.key])
    ),
  ];

  return (
    "\uFEFF" +
    report
      .map((record) => record.map(escape).join(","))
      .join("\r\n")
  );
}

async function createExcel(title, columns, rows, summary = []) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Mike Digitals";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell("A1").value = "MIKE DIGITALS";
  sheet.getCell("A1").font = {
    bold: true,
    size: 18,
    color: { argb: "FFF97316" },
  };

  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell("A2").value = title;
  sheet.getCell("A2").font = { bold: true, size: 14 };

  sheet.mergeCells(3, 1, 3, columns.length);
  sheet.getCell("A3").value =
    `Generated: ${new Date().toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
    })}`;

  let headerRow = 4;

  if (summary.length) {
    summary.forEach((item, index) => {
      const row = sheet.getRow(4 + index);
      row.getCell(1).value = item.label;
      row.getCell(2).value = item.value;
      row.getCell(1).font = { bold: true };
    });

    headerRow = 5 + summary.length;
  }

  const headers = columns.map((column) => column.header);
  const header = sheet.getRow(headerRow);
  header.values = headers;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF97316" },
  };

  rows.forEach((record) => {
    sheet.addRow(
      columns.map((column) => {
        const value = record[column.key];

        return typeof value === "number"
          ? value
          : cleanValue(value);
      })
    );
  });

  columns.forEach((column, index) => {
    const values = rows.map((row) =>
      cleanValue(row[column.key])
    );

    const longest = Math.max(
      column.header.length,
      ...values.map((value) => Math.min(value.length, 45))
    );

    sheet.getColumn(index + 1).width = Math.min(
      Math.max(longest + 3, 14),
      45
    );
  });

  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow + rows.length, column: columns.length },
  };

  sheet.eachRow((row) => {
    row.alignment = {
      vertical: "middle",
      wrapText: true,
    };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}



async function createRepairHistoryPdf(title, columns, rows, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: {
        top: 22,
        bottom: 35,
        left: 24,
        right: 24,
      },
      bufferPages: true,
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 24;
    const right = 24;
    const usableWidth = pageWidth - left - right;
    const bottomLimit = pageHeight - 38;

    const generatedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const money = (value) =>
      Number(value || 0).toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    // --------------------------------------------------
    // REPORT HEADER
    // --------------------------------------------------

    function drawReportHeader() {
      doc.fillColor("#f97316")
        .font("Helvetica-Bold")
        .fontSize(19)
        .text("Mike Digitals", left, 22);

      doc.fillColor("#222222")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(options.title || title, left, 46);

      doc.fillColor("#555555")
        .font("Helvetica")
        .fontSize(8)
        .text(
          `${rows.length} job(s) · ${options.subtitle || "All records"}`,
          left,
          65,
          { width: usableWidth }
        );

      doc.fillColor("#777777")
        .fontSize(7.5)
        .text(
          `Generated ${generatedAt} by ${options.generatedBy || "Admin"}`,
          left,
          78
        );

      doc.moveTo(left, 94)
        .lineTo(pageWidth - right, 94)
        .strokeColor("#dddddd")
        .stroke();
    }

    // --------------------------------------------------
    // TABLE COLUMN WIDTHS
    // --------------------------------------------------

    const weights = [
      1.35, // Job ID
      0.95, // Date received
      1.15, // Customer
      1.25, // Device
      1.55, // Fault reported
      1.05, // Parts used
      0.85, // Price
      0.85, // Paid
      0.85, // Balance
      0.90, // Status
    ];

    const totalWeight = weights.reduce(
      (sum, weight) => sum + weight,
      0
    );

    const columnWidths = weights.map(
      (weight) => (weight / totalWeight) * usableWidth
    );

    const cellPadding = 3;
    const bodyFontSize = 6.5;
    const headerFontSize = 6.5;

    // --------------------------------------------------
    // TABLE HEADER
    // --------------------------------------------------

    function drawTableHeader(y) {
      const headerHeight = 27;
      let x = left;

      columns.forEach((column, index) => {
        const width = columnWidths[index];

        doc.rect(x, y, width, headerHeight)
          .fillAndStroke("#f97316", "#ffffff");

        doc.fillColor("#ffffff")
          .font("Helvetica-Bold")
          .fontSize(headerFontSize)
          .text(
            String(column.header),
            x + cellPadding,
            y + 5,
            {
              width: width - cellPadding * 2,
              height: headerHeight - 8,
              lineGap: 0,
            }
          );

        x += width;
      });

      return y + headerHeight;
    }

    // --------------------------------------------------
    // TABLE BODY
    // --------------------------------------------------

    drawReportHeader();

    let tableY = drawTableHeader(102);

    if (!rows.length) {
      doc.fillColor("#555555")
        .font("Helvetica")
        .fontSize(9)
        .text(
          "No records matched the selected filters.",
          left,
          tableY + 12
        );
    }

    rows.forEach((record, rowIndex) => {
      const values = columns.map((column) => {
        const value = record[column.key];

        if (
          ["repairCost", "amountPaid", "balance"].includes(column.key)
        ) {
          return money(value);
        }

        return cleanValue(value);
      });

      const cellHeights = values.map((value, index) =>
        doc.heightOfString(value, {
          width: columnWidths[index] - cellPadding * 2,
          font: "Helvetica",
          fontSize: bodyFontSize,
          lineGap: 0,
          paragraphGap: 0,
        })
      );

      const rowHeight =
        Math.max(11, ...cellHeights) + cellPadding * 2;

      if (tableY + rowHeight > bottomLimit) {
        doc.addPage();
        tableY = drawTableHeader(28);
      }

      const background =
        rowIndex % 2 === 0 ? "#ffffff" : "#fff7ed";

      let x = left;

      values.forEach((value, index) => {
        const width = columnWidths[index];

        doc.rect(x, tableY, width, rowHeight)
          .fillAndStroke(background, "#d1d5db");

        doc.fillColor("#333333")
          .font("Helvetica")
          .fontSize(bodyFontSize)
          .text(
            value,
            x + cellPadding,
            tableY + cellPadding,
            {
              width: width - cellPadding * 2,
              lineGap: 0,
              paragraphGap: 0,
            }
          );

        x += width;
      });

      tableY += rowHeight;
    });

    // --------------------------------------------------
    // COMPACT TOTALS ROW
    // --------------------------------------------------

    const totalRepairCost = rows.reduce(
      (sum, row) => sum + Number(row.repairCost || 0),
      0
    );

    const totalPaid = rows.reduce(
      (sum, row) => sum + Number(row.amountPaid || 0),
      0
    );

    const totalBalance = rows.reduce(
      (sum, row) => sum + Number(row.balance || 0),
      0
    );

    const totalsHeight = 21;

    if (tableY + totalsHeight > bottomLimit) {
      doc.addPage();
      tableY = drawTableHeader(28);
    } else {
      tableY += 4;
    }

    const totalValues = [
      `TOTAL (${rows.length})`,
      "",
      "",
      "",
      "",
      "",
      money(totalRepairCost),
      money(totalPaid),
      money(totalBalance),
      "",
    ];

    let totalX = left;

    totalValues.forEach((value, index) => {
      const width = columnWidths[index];

      doc.rect(totalX, tableY, width, totalsHeight)
        .fillAndStroke("#fff0df", "#d1d5db");

      if (value) {
        doc.fillColor("#222222")
          .font("Helvetica-Bold")
          .fontSize(6.5)
          .text(
            value,
            totalX + cellPadding,
            tableY + 6,
            {
              width: width - cellPadding * 2,
              lineBreak: false,
              ellipsis: true,
            }
          );
      }

      totalX += width;
    });

    // --------------------------------------------------
    // PAGE NUMBERS
    // --------------------------------------------------

    const pageRange = doc.bufferedPageRange();

    for (
      let index = pageRange.start;
      index < pageRange.start + pageRange.count;
      index++
    ) {
      doc.switchToPage(index);

      doc.font("Helvetica")
        .fontSize(7)
        .fillColor("#888888")
        .text(
          `Mike Digitals · ${options.title || title} · Page ${
            index - pageRange.start + 1
          } of ${pageRange.count}`,
          left,
          pageHeight - 23,
          {
            width: usableWidth,
            align: "center",
          }
        );
    }

    doc.end();
  });
}


async function createPdf(title, columns, rows, summary = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: {
        top: 25,
        bottom: 35,
        left: 24,
        right: 24,
      },
      bufferPages: true,
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 24;
    const right = 24;
    const usableWidth = pageWidth - left - right;
    const bottomLimit = pageHeight - 38;

    const generatedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    // --------------------------------------------------
    // REPORT HEADER
    // --------------------------------------------------

    doc.fillColor("#f97316")
      .font("Helvetica-Bold")
      .fontSize(19)
      .text("MIKE DIGITALS", left, 22);

    doc.fillColor("#222222")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(title, left, 46);

    doc.fillColor("#555555")
      .font("Helvetica")
      .fontSize(8)
      .text(`${rows.length} record(s)`, left, 65);

    doc.fillColor("#777777")
      .fontSize(7.5)
      .text(`Generated ${generatedAt}`, left, 78);

    doc.moveTo(left, 94)
      .lineTo(pageWidth - right, 94)
      .strokeColor("#dddddd")
      .stroke();

    // --------------------------------------------------
    // COLUMN WIDTHS
    // Allocate space according to column purpose.
    // --------------------------------------------------

    const getColumnWeight = (column) => {
      const name =
        `${column.key} ${column.header}`.toLowerCase();

      if (
        name.includes("reference") ||
        name.includes("jobid") ||
        name.includes("job id") ||
        name.includes("sale number")
      ) {
        return 1.45;
      }

      if (name.includes("date")) return 1.05;

      if (
        name.includes("customer") ||
        name.includes("name")
      ) {
        return 1.25;
      }

      if (
        name.includes("device") ||
        name.includes("product") ||
        name.includes("item")
      ) {
        return 1.2;
      }

      if (
        name.includes("description") ||
        name.includes("fault")
      ) {
        return 1.45;
      }

      if (
        name.includes("parts") ||
        name.includes("notes")
      ) {
        return 1.5;
      }

      if (
        name.includes("price") ||
        name.includes("amount") ||
        name.includes("paid") ||
        name.includes("balance") ||
        name.includes("quantity") ||
        name.includes("qty")
      ) {
        return 0.9;
      }

      if (
        name.includes("status") ||
        name.includes("payment")
      ) {
        return 1.0;
      }

      return 1.15;
    };

    const weights = columns.map(getColumnWeight);

    const totalWeight = weights.reduce(
      (total, weight) => total + weight,
      0
    );

    const columnWidths = weights.map(
      (weight) =>
        (weight / totalWeight) * usableWidth
    );

    const cellPadding = 3.5;
    const bodyFontSize = 6.5;
    const headerFontSize = 6.5;

    // --------------------------------------------------
    // TABLE HEADER
    // --------------------------------------------------

    function drawTableHeader(y) {
      const headerHeight = 29;
      let x = left;

      columns.forEach((column, index) => {
        const width = columnWidths[index];

        doc.rect(x, y, width, headerHeight)
          .fillAndStroke("#f97316", "#ffffff");

        doc.fillColor("#ffffff")
          .font("Helvetica-Bold")
          .fontSize(headerFontSize)
          .text(
            String(column.header),
            x + cellPadding,
            y + 5,
            {
              width: width - cellPadding * 2,
              height: headerHeight - 8,
              lineGap: 0,
            }
          );

        x += width;
      });

      return y + headerHeight;
    }

    // First page starts below the report heading.
    let tableY = drawTableHeader(102);

    // --------------------------------------------------
    // EMPTY REPORT
    // --------------------------------------------------

    if (!rows.length) {
      doc.fillColor("#555555")
        .font("Helvetica")
        .fontSize(9)
        .text(
          "No records matched the selected filters.",
          left,
          tableY + 12
        );
    }

    // --------------------------------------------------
    // TABLE BODY
    // One record = one horizontal row.
    // --------------------------------------------------

    rows.forEach((record, rowIndex) => {
      const values = columns.map((column) =>
        cleanValue(record[column.key])
      );

      // Measure each cell's wrapped text.
      const cellHeights = values.map((value, index) => {
        return doc.heightOfString(value, {
          width: columnWidths[index] - cellPadding * 2,
          font: "Helvetica",
          fontSize: bodyFontSize,
          lineGap: 0,
          paragraphGap: 0,
        });
      });

      const rowHeight =
        Math.max(11, ...cellHeights) + cellPadding * 2;

      // Start a new page when the row will not fit.
      if (tableY + rowHeight > bottomLimit) {
        doc.addPage();

        // Repeat column headings on every new page.
        tableY = drawTableHeader(28);
      }

      const background =
        rowIndex % 2 === 0 ? "#ffffff" : "#fff7ed";

      let x = left;

      values.forEach((value, index) => {
        const width = columnWidths[index];

        // Cell background and border.
        doc.rect(x, tableY, width, rowHeight)
          .fillAndStroke(background, "#d1d5db");

        // Cell text.
        doc.fillColor("#333333")
          .font("Helvetica")
          .fontSize(bodyFontSize)
          .text(
            value,
            x + cellPadding,
            tableY + cellPadding,
            {
              width: width - cellPadding * 2,
              lineGap: 0,
              paragraphGap: 0,
            }
          );

        x += width;
      });

      tableY += rowHeight;
    });

    // --------------------------------------------------
    // REPORT SUMMARY / TOTALS
    // Display after the table.
    // --------------------------------------------------

    if (summary.length) {
      const summaryTitleHeight = 22;
      const summaryRowHeight = 18;
      const summaryHeight =
        summaryTitleHeight +
        summary.length * summaryRowHeight +
        8;

      if (tableY + summaryHeight > bottomLimit) {
        doc.addPage();
        tableY = 35;
      } else {
        tableY += 12;
      }

      doc.fillColor("#222222")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("REPORT TOTALS", left, tableY);

      tableY += summaryTitleHeight;

      summary.forEach((item, index) => {
        const background =
          index % 2 === 0 ? "#fff7ed" : "#ffffff";

        doc.rect(left, tableY, usableWidth, summaryRowHeight)
          .fillAndStroke(background, "#dddddd");

        doc.fillColor("#333333")
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .text(
            cleanValue(item.label),
            left + 6,
            tableY + 5,
            {
              width: usableWidth * 0.55,
            }
          );

        doc.font("Helvetica")
          .text(
            cleanValue(item.value),
            left + usableWidth * 0.58,
            tableY + 5,
            {
              width: usableWidth * 0.4,
            }
          );

        tableY += summaryRowHeight;
      });
    }

    // --------------------------------------------------
    // PAGE NUMBERS
    // --------------------------------------------------

    const pageRange = doc.bufferedPageRange();

    for (
      let index = pageRange.start;
      index < pageRange.start + pageRange.count;
      index++
    ) {
      doc.switchToPage(index);

      doc.font("Helvetica")
        .fontSize(7)
        .fillColor("#888888")
        .text(
          `Mike Digitals · ${title} · Page ${
            index - pageRange.start + 1
          } of ${pageRange.count}`,
          left,
          pageHeight - 23,
          {
            width: usableWidth,
            align: "center",
          }
        );
    }

    doc.end();
  });
}

async function createWord(title, columns, rows, summary = []) {
  const children = [
    new Paragraph({
      text: "MIKE DIGITALS",
      heading: HeadingLevel.HEADING_1,
    }),

    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_2,
    }),

    new Paragraph({
      text: `Generated: ${new Date().toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
      })}`,
    }),

    new Paragraph({ text: "" }),
  ];

  summary.forEach((item) => {
    children.push(
      new Paragraph({
        children: [
          {
            text: `${item.label}: `,
            bold: true,
          },
          {
            text: cleanValue(item.value),
          },
        ],
      })
    );
  });

  if (summary.length) {
    children.push(new Paragraph({ text: "" }));
  }

  if (!rows.length) {
    children.push(
      new Paragraph({
        text: "No records matched the selected filters.",
      })
    );
  }

  rows.forEach((record, index) => {
    children.push(
      new Paragraph({
        text: `Record ${index + 1}`,
        heading: HeadingLevel.HEADING_3,
      })
    );

    columns.forEach((column) => {
      children.push(
        new Paragraph({
          children: [
            {
              text: `${column.header}: `,
              bold: true,
            },
            {
              text: cleanValue(record[column.key]),
            },
          ],
        })
      );
    });

    children.push(new Paragraph({ text: "" }));
  });

  const document = new Document({
    creator: "Mike Digitals",
    title,
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

async function generateExport({
  title,
  columns,
  rows,
  summary = [],
  format,
  pdfOptions = {},
}) {
  const normalizedFormat = String(format || "").toLowerCase();

  if (!FORMATS[normalizedFormat]) {
    throw new Error("Unsupported export format.");
  }

  let buffer;

  if (normalizedFormat === "csv") {
      buffer = Buffer.from(
      createCsv(title, columns, rows, summary),
      "utf8"
    );
  } else if (normalizedFormat === "xlsx") {
    buffer = await createExcel(title, columns, rows, summary);
  } else if (normalizedFormat === "pdf") {
      if (pdfOptions.layout === "repair-history") {
      buffer = await createRepairHistoryPdf(
        title,
        pdfOptions.columns,
        pdfOptions.rows,
        pdfOptions
      );
    } else {
      buffer = await createPdf(title, columns, rows, summary);
    }
  } else {
    buffer = await createWord(title, columns, rows, summary);
  }

  return {
    buffer,
    contentType: FORMATS[normalizedFormat],
    filename: `${safeFilename(title)}-${new Date()
      .toISOString()
      .slice(0, 10)}.${normalizedFormat}`,
  };
}

module.exports = {
  generateExport,
};

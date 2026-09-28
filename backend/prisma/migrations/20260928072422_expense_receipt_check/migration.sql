-- Hand-written (D12, D36): a receipt's four columns are set together or not at all.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receipt_complete" CHECK (
  ("receiptPath" IS NULL AND "receiptMime" IS NULL AND "receiptName" IS NULL AND "receiptSize" IS NULL)
  OR ("receiptPath" IS NOT NULL AND "receiptMime" IS NOT NULL AND "receiptName" IS NOT NULL AND "receiptSize" > 0)
);

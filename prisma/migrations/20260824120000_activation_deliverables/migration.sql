-- What a creator owes on one activation.
--
-- Purely additive: one new table, no change to any existing column, so it
-- cannot touch data that is already there. Applied directly rather than through
-- migrate deploy, because _prisma_migrations in this database is two entries
-- behind the schema it actually has -- the last two changes went in with
-- db push -- and deploy would try to re-run them.
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "activationId" TEXT NOT NULL,
    "typeDefId" TEXT,
    "name" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Deliverable_activationId_idx" ON "Deliverable"("activationId");

CREATE INDEX "Deliverable_typeDefId_idx" ON "Deliverable"("typeDefId");

ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES "Activation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_typeDefId_fkey" FOREIGN KEY ("typeDefId") REFERENCES "DeliverableTypeDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

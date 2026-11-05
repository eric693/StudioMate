-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LockerRentalStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PAID', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MembershipStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "MembershipStatus" ADD VALUE 'TRANSFERRED';

-- AlterEnum
ALTER TYPE "OrderMethod" ADD VALUE 'LINEPAY';

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "originalCoachId" TEXT,
ADD COLUMN     "substituteNote" TEXT;

-- AlterTable
ALTER TABLE "Coach" ADD COLUMN     "shareTiers" JSONB;

-- AlterTable
ALTER TABLE "Member" ALTER COLUMN "calendarToken" SET DEFAULT replace(gen_random_uuid()::text, '-', '');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "transferredFromId" TEXT,
ADD COLUMN     "valueBase" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "installment" INTEGER,
ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "accessAutoCheckIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accessSecret" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
ADD COLUMN     "birthdayCoupon" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "birthdayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birthdayMessage" TEXT,
ADD COLUMN     "contractEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contractText" TEXT,
ADD COLUMN     "installmentMin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "installments" TEXT,
ADD COLUMN     "linePayChannelId" TEXT,
ADD COLUMN     "linePayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linePayMode" TEXT NOT NULL DEFAULT 'sandbox',
ADD COLUMN     "linePaySecret" TEXT,
ADD COLUMN     "refundFeePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trustBank" TEXT,
ADD COLUMN     "trustNote" TEXT,
ADD COLUMN     "trustType" TEXT,
ADD COLUMN     "winbackCoupon" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "winbackDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "winbackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "winbackMessage" TEXT,
ALTER COLUMN "checkInToken" SET DEFAULT replace(gen_random_uuid()::text, '-', '');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coachId" TEXT;

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "usedValue" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "method" "PayMethod" NOT NULL DEFAULT 'CASH',
    "reason" TEXT,
    "allowanceNo" TEXT,
    "invoiceAction" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tradeNo" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "execTimes" INTEGER NOT NULL,
    "successTimes" INTEGER NOT NULL DEFAULT 0,
    "failTimes" INTEGER NOT NULL DEFAULT 0,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastPaidAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "substituteId" TEXT,
    "reviewNote" TEXT,
    "createdById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT,
    "deviceId" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "measuredAt" DATE NOT NULL,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "muscleKg" DOUBLE PRECISION,
    "visceralFat" DOUBLE PRECISION,
    "bmr" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "size" TEXT,
    "monthlyRate" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Locker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockerRental" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lockerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "payMethod" "PayMethod" NOT NULL DEFAULT 'CASH',
    "status" "LockerRentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockerRental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedIp" TEXT,
    "channel" TEXT NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "sku" TEXT,
    "price" INTEGER NOT NULL,
    "cost" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "lowStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSale" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT,
    "total" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "payMethod" "PayMethod" NOT NULL DEFAULT 'CASH',
    "status" "SaleStatus" NOT NULL DEFAULT 'PAID',
    "note" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "invoiceStatus" TEXT,
    "invoiceError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ProductSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMove" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "saleId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATE,
    "pushed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "afterClass" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sessionId" TEXT,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_userId_createdAt_idx" ON "Refund"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tradeNo_key" ON "Subscription"("tradeNo");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_status_idx" ON "LeaveRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "StaffShift_userId_date_idx" ON "StaffShift"("userId", "date");

-- CreateIndex
CREATE INDEX "TimeClock_userId_clockIn_idx" ON "TimeClock"("userId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeClock_staffId_clockIn_idx" ON "TimeClock"("staffId", "clockIn");

-- CreateIndex
CREATE UNIQUE INDEX "AccessDevice_token_key" ON "AccessDevice"("token");

-- CreateIndex
CREATE INDEX "AccessLog_userId_createdAt_idx" ON "AccessLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_memberId_createdAt_idx" ON "AccessLog"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "BodyMetric_memberId_measuredAt_idx" ON "BodyMetric"("memberId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Locker_userId_code_key" ON "Locker"("userId", "code");

-- CreateIndex
CREATE INDEX "LockerRental_userId_status_endDate_idx" ON "LockerRental"("userId", "status", "endDate");

-- CreateIndex
CREATE INDEX "Contract_memberId_idx" ON "Contract"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_name_key" ON "Product"("userId", "name");

-- CreateIndex
CREATE INDEX "ProductSale_userId_createdAt_idx" ON "ProductSale"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMove_productId_createdAt_idx" ON "StockMove"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_userId_createdAt_idx" ON "Announcement"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_surveyId_memberId_sessionId_key" ON "SurveyResponse"("surveyId", "memberId", "sessionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_originalCoachId_fkey" FOREIGN KEY ("originalCoachId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "Coach"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClock" ADD CONSTRAINT "TimeClock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClock" ADD CONSTRAINT "TimeClock_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDevice" ADD CONSTRAINT "AccessDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AccessDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMetric" ADD CONSTRAINT "BodyMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMetric" ADD CONSTRAINT "BodyMetric_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locker" ADD CONSTRAINT "Locker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockerRental" ADD CONSTRAINT "LockerRental_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockerRental" ADD CONSTRAINT "LockerRental_lockerId_fkey" FOREIGN KEY ("lockerId") REFERENCES "Locker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockerRental" ADD CONSTRAINT "LockerRental_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT "ProductSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ProductSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT "ProductSaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


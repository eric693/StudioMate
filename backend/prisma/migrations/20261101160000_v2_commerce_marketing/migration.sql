-- CreateEnum
CREATE TYPE "OrderMethod" AS ENUM ('ONLINE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "RoomBookingStatus" AS ENUM ('BOOKED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveUrl" TEXT;

-- AlterTable
ALTER TABLE "ClassType" ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Coach" ADD COLUMN     "headThreshold" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payPerClass" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payPerHead" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revenueShare" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "calendarToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
ADD COLUMN     "invoiceCarrierNum" TEXT,
ADD COLUMN     "invoiceCarrierType" TEXT,
ADD COLUMN     "invoiceTaxId" TEXT,
ADD COLUMN     "invoiceTitle" TEXT,
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceError" TEXT,
ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "invoiceRandom" TEXT,
ADD COLUMN     "invoiceStatus" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "description" TEXT,
ADD COLUMN     "onlineSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trialOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScheduleTemplate" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "liveUrl" TEXT;

-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "bankInfo" TEXT,
ADD COLUMN     "checkInBeforeMin" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "checkInToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
ADD COLUMN     "ecpayHashIV" TEXT,
ADD COLUMN     "ecpayHashKey" TEXT,
ADD COLUMN     "ecpayMerchantId" TEXT,
ADD COLUMN     "ecpayMode" TEXT NOT NULL DEFAULT 'stage',
ADD COLUMN     "invoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invoiceHashIV" TEXT,
ADD COLUMN     "invoiceHashKey" TEXT,
ADD COLUMN     "invoiceMerchantId" TEXT,
ADD COLUMN     "invoiceMode" TEXT NOT NULL DEFAULT 'stage',
ADD COLUMN     "lateCancelCountsAsNoShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "noShowLimit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "noShowSuspendDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "noShowWindowDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "onlinePayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralRewardAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "selfCheckIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "termsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transferEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAvailability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "CoachAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tradeNo" TEXT NOT NULL,
    "method" "OrderMethod" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "originalAmount" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "couponId" TEXT,
    "transferLast5" TEXT,
    "transferAt" TIMESTAMP(3),
    "providerTradeNo" TEXT,
    "paymentType" TEXT,
    "paidAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "membershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minAmount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "perMemberLimit" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATE,
    "validTo" DATE,
    "memberId" TEXT,
    "newMemberOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT,
    "discount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "sandbox" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "hourlyRate" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomBooking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "memberId" TEXT,
    "renterName" TEXT NOT NULL,
    "renterPhone" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "price" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "payMethod" "PayMethod",
    "status" "RoomBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_userId_name_key" ON "Branch"("userId", "name");

-- CreateIndex
CREATE INDEX "CoachAvailability_coachId_weekday_idx" ON "CoachAvailability"("coachId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tradeNo_key" ON "Order"("tradeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Order_membershipId_key" ON "Order"("membershipId");

-- CreateIndex
CREATE INDEX "Order_userId_status_createdAt_idx" ON "Order"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_userId_code_key" ON "Coupon"("userId", "code");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_memberId_idx" ON "CouponRedemption"("couponId", "memberId");

-- CreateIndex
CREATE INDEX "Campaign_userId_createdAt_idx" ON "Campaign"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_userId_name_key" ON "Room"("userId", "name");

-- CreateIndex
CREATE INDEX "RoomBooking_userId_startsAt_idx" ON "RoomBooking"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "RoomBooking_roomId_startsAt_idx" ON "RoomBooking"("roomId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Member_referralCode_key" ON "Member"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Member_calendarToken_key" ON "Member"("calendarToken");

-- CreateIndex
CREATE UNIQUE INDEX "Studio_checkInToken_key" ON "Studio"("checkInToken");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailability" ADD CONSTRAINT "CoachAvailability_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;


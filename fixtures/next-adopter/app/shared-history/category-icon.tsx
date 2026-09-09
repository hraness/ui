"use client";

import Analytics01Icon from "@hugeicons/core-free-icons/Analytics01Icon";
import CalculatorIcon from "@hugeicons/core-free-icons/CalculatorIcon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import Coins01Icon from "@hugeicons/core-free-icons/Coins01Icon";
import ConnectIcon from "@hugeicons/core-free-icons/ConnectIcon";
import CreditCardIcon from "@hugeicons/core-free-icons/CreditCardIcon";
import Flag01Icon from "@hugeicons/core-free-icons/Flag01Icon";
import Location01Icon from "@hugeicons/core-free-icons/Location01Icon";
import MapsIcon from "@hugeicons/core-free-icons/MapsIcon";
import Money01Icon from "@hugeicons/core-free-icons/Money01Icon";
import News01Icon from "@hugeicons/core-free-icons/News01Icon";
import PodcastIcon from "@hugeicons/core-free-icons/PodcastIcon";
import PuzzleIcon from "@hugeicons/core-free-icons/PuzzleIcon";
import RocketIcon from "@hugeicons/core-free-icons/RocketIcon";
import ShoppingCart01Icon from "@hugeicons/core-free-icons/ShoppingCart01Icon";
import UserMultiple02Icon from "@hugeicons/core-free-icons/UserMultiple02Icon";
import { HugeiconsIcon } from "@hugeicons/react";

const historyCategoryIcons = {
  acquisitions: ConnectIcon,
  all: Calendar03Icon,
  appearances: PodcastIcon,
  "company-milestones": Flag01Icon,
  "country-expansion": MapsIcon,
  "executives-and-team": UserMultiple02Icon,
  fundraising: Coins01Icon,
  "headquarters-and-offices": Location01Icon,
  "origins-and-early-company": RocketIcon,
  "payment-and-payout-expansion": CreditCardIcon,
  "net-revenue": Money01Icon,
  "payment-volume": Analytics01Icon,
  "product-launches": ShoppingCart01Icon,
  publishing: News01Icon,
  "side-quests": PuzzleIcon,
  valuation: CalculatorIcon,
} as const;

type HistoryFilterVisualId = keyof typeof historyCategoryIcons;

export function HistoryCategoryIcon({
  className,
  filterId,
}: Readonly<{ className?: string | undefined; filterId: HistoryFilterVisualId }>) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={`stripe-history-icon history-category-icon${className === undefined ? "" : ` ${className}`}`}
      color="currentColor"
      icon={historyCategoryIcons[filterId]}
      size={16}
      strokeWidth={1.7}
    />
  );
}

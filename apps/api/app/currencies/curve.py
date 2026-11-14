import math
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal, localcontext

WORTH_IN_DISCOIN = Decimal(100_000)
CENT = Decimal("0.01")
EXACT_PRECISION = 60


class CurveError(ValueError):
    pass


@dataclass(frozen=True)
class CurveSide:
    reserve: Decimal
    worth: Decimal = WORTH_IN_DISCOIN

    def __post_init__(self) -> None:
        if self.reserve <= 0:
            raise CurveError(f"Reserve must be positive, got {self.reserve}")

        if self.worth <= 0:
            raise CurveError(f"Worth must be positive, got {self.worth}")


def floor2(amount: Decimal) -> Decimal:
    return amount.quantize(CENT, rounding=ROUND_FLOOR)


def scaled_share(total: Decimal, part: Decimal, whole: Decimal) -> Decimal:
    with localcontext(prec=EXACT_PRECISION):
        return floor2(total * part / whole)


def value(side: CurveSide) -> Decimal:
    return side.worth / side.reserve


def rate(source: CurveSide, target: CurveSide) -> Decimal:
    return value(source) / value(target)


def payout(amount: Decimal, source: CurveSide, target: CurveSide) -> Decimal:
    if amount <= 0:
        raise CurveError(f"Amount must be positive, got {amount}")

    if source.worth == target.worth:
        return scaled_share(target.reserve, amount, source.reserve + amount)

    exponent = float(source.worth / target.worth)
    added_share = float(amount / (source.reserve + amount))
    paid_share = -math.expm1(exponent * math.log1p(-added_share))

    result = floor2(target.reserve * Decimal(paid_share))
    if result >= target.reserve:
        raise CurveError(f"A payout of {result} would empty the reserve of {target.reserve}")

    return result


def give_back(paid_out: Decimal, source: CurveSide, target: CurveSide) -> Decimal:
    return payout(paid_out, source=target, target=source)


def max_amount(remaining: Decimal, source: CurveSide, target: CurveSide) -> Decimal | None:
    if remaining <= 0:
        return Decimal("0.00")

    if remaining >= target.reserve:
        return None

    if source.worth == target.worth:
        return scaled_share(source.reserve, remaining, target.reserve - remaining)

    exponent = -float(target.worth / source.worth)
    growth = math.expm1(exponent * math.log1p(-float(remaining / target.reserve)))

    return floor2(source.reserve * Decimal(growth))

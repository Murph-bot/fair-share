"""Tests for splitter.py — equal and weighted splitting."""

import pytest

from fairshare.errors import ValidationError
from fairshare.splitter import equal_split, weighted_split


class TestEqualSplit:
    def test_divides_evenly(self):
        shares = equal_split(9000, 3)
        assert shares == [3000, 3000, 3000]

    def test_sum_equals_total(self):
        shares = equal_split(100, 3)
        assert sum(shares) == 100

    def test_remainder_distributed_to_first(self):
        # 10 cents / 3 → [4, 3, 3]
        shares = equal_split(10, 3)
        assert shares == [4, 3, 3]

    def test_single_participant(self):
        assert equal_split(5000, 1) == [5000]

    def test_two_participants_odd(self):
        shares = equal_split(101, 2)
        assert shares == [51, 50]
        assert sum(shares) == 101

    def test_many_remainder_cents(self):
        # 7 cents / 5 → [2, 2, 1, 1, 1]
        shares = equal_split(7, 5)
        assert sum(shares) == 7
        assert shares[0] == 2
        assert shares[1] == 2
        assert shares[2] == 1

    def test_zero_amount_raises(self):
        with pytest.raises(ValidationError):
            equal_split(0, 3)

    def test_negative_amount_raises(self):
        with pytest.raises(ValidationError):
            equal_split(-100, 3)

    def test_zero_n_raises(self):
        with pytest.raises(ValidationError):
            equal_split(100, 0)

    def test_negative_n_raises(self):
        with pytest.raises(ValidationError):
            equal_split(100, -1)


class TestWeightedSplit:
    def test_equal_weights_same_as_equal_split(self):
        shares = weighted_split(9000, [1, 1, 1])
        assert shares == [3000, 3000, 3000]

    def test_sum_equals_total(self):
        shares = weighted_split(100, [2, 1, 1])
        assert sum(shares) == 100

    def test_proportional(self):
        # 100 cents, weights [2,1,1] → [50, 25, 25]
        shares = weighted_split(100, [2, 1, 1])
        assert shares == [50, 25, 25]

    def test_hamilton_remainder(self):
        # 10 cents, weights [1,1,1] → [4,3,3] (largest remainder)
        shares = weighted_split(10, [1, 1, 1])
        assert sum(shares) == 10

    def test_asymmetric_weights(self):
        # Hotel: 9000 cents, weights [2,1,1] → [4500, 2250, 2250]
        shares = weighted_split(9000, [2, 1, 1])
        assert shares == [4500, 2250, 2250]
        assert sum(shares) == 9000

    def test_single_weight(self):
        assert weighted_split(5000, [1]) == [5000]

    def test_zero_amount_raises(self):
        with pytest.raises(ValidationError):
            weighted_split(0, [1, 1])

    def test_negative_amount_raises(self):
        with pytest.raises(ValidationError):
            weighted_split(-100, [1, 1])

    def test_empty_weights_raises(self):
        with pytest.raises(ValidationError):
            weighted_split(100, [])

    def test_zero_weight_raises(self):
        with pytest.raises(ValidationError):
            weighted_split(100, [1, 0])

    def test_negative_weight_raises(self):
        with pytest.raises(ValidationError):
            weighted_split(100, [1, -1])

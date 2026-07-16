"""Tests for money.py — parsing and formatting."""

import pytest

from fairshare.errors import ValidationError
from fairshare.money import cents_to_str, parse_amount


class TestParseAmount:
    def test_plain_integer(self):
        assert parse_amount("60") == 6000

    def test_two_decimal_places(self):
        assert parse_amount("60.00") == 6000

    def test_fractional_cents(self):
        assert parse_amount("60.50") == 6050

    def test_dollar_prefix(self):
        assert parse_amount("$60") == 6000

    def test_dollar_prefix_with_decimals(self):
        assert parse_amount("$60.50") == 6050

    def test_one_decimal_place(self):
        assert parse_amount("9.9") == 990

    def test_zero_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("0")

    def test_zero_decimal_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("0.00")

    def test_negative_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("-10")

    def test_empty_string_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("")

    def test_alpha_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("abc")

    def test_three_decimals_raises(self):
        with pytest.raises(ValidationError):
            parse_amount("10.123")

    def test_large_amount(self):
        assert parse_amount("9999.99") == 999999

    def test_small_amount(self):
        assert parse_amount("0.01") == 1


class TestCentsToStr:
    def test_zero(self):
        assert cents_to_str(0) == "$0.00"

    def test_whole_dollars(self):
        assert cents_to_str(6000) == "$60.00"

    def test_mixed(self):
        assert cents_to_str(6050) == "$60.50"

    def test_single_cent(self):
        assert cents_to_str(1) == "$0.01"

    def test_nine_cents(self):
        assert cents_to_str(9) == "$0.09"

    def test_negative(self):
        assert cents_to_str(-5050) == "-$50.50"

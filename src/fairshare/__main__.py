"""Allow ``python -m fairshare``."""

from __future__ import annotations

import sys

from fairshare.cli import main

if __name__ == "__main__":
    sys.exit(main())

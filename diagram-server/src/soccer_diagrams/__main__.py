"""Allow running as `python -m soccer_diagrams.server`."""

from .server import main
import asyncio

asyncio.run(main())

import threading
import time
from collections import defaultdict, deque

SWEEP_EVERY_REQUESTS = 1_000


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.requests_seen = 0
        self.lock = threading.Lock()

    def admit(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            self.requests_seen += 1
            if self.requests_seen % SWEEP_EVERY_REQUESTS == 0:
                self.forget_idle_keys(now)

            hits = self.hits[key]
            self.drop_expired(hits, now)
            if len(hits) >= self.limit:
                return False

            hits.append(now)

        return True

    def drop_expired(self, hits: deque[float], now: float) -> None:
        while hits and hits[0] <= now - self.window_seconds:
            hits.popleft()

    def forget_idle_keys(self, now: float) -> None:
        for key in list(self.hits):
            self.drop_expired(self.hits[key], now)
            if not self.hits[key]:
                del self.hits[key]

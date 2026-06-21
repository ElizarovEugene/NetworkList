"""DNS reverse (PTR) lookups."""
import dns.resolver
import dns.reversename
from dataclasses import dataclass
from typing import Optional


@dataclass
class DNSResult:
    ip: str
    ptr_record: Optional[str] = None
    hostname: Optional[str] = None   # first A/AAAA that resolves back to ip


def reverse_lookup(ip: str) -> DNSResult:
    result = DNSResult(ip=ip)
    try:
        rev = dns.reversename.from_address(ip)
        answers = dns.resolver.resolve(rev, "PTR", lifetime=3)
        ptr = str(answers[0]).rstrip(".")
        result.ptr_record = ptr
        result.hostname = ptr
    except Exception:
        pass
    return result

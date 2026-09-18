"""Kaputt! 3.0 K3-E1 exact state analyzer.

No external dependencies. Enumerates the six possible hidden second-die
outcomes for every visible die (1..6) and NtB (0..36).

This is an analysis model, not yet a full game-mode simulator.
"""
from dataclasses import dataclass
from fractions import Fraction
import csv
from pathlib import Path

EXTREMES={(1,6),(6,1)}

@dataclass(frozen=True)
class Outcome:
    action:str
    visible:int
    hidden:int
    ntb:int
    extreme:bool
    value:int
    points:int
    success:bool
    kaputt:bool
    next_ntb:int

def resolve(action:str, visible:int, hidden:int, ntb:int)->Outcome:
    if action not in {"attack","defense"}:
        raise ValueError("action must be attack or defense")
    extreme=(visible,hidden) in EXTREMES
    if action=="attack":
        value=36 if extreme else visible*hidden
        success=value>ntb
        return Outcome(action,visible,hidden,ntb,extreme,value,
                       value if success else 0,success,not success,
                       value if success else ntb)
    value=2 if extreme else visible+hidden
    points=1 if extreme else max(visible,hidden)
    return Outcome(action,visible,hidden,ntb,extreme,value,points,
                   value>ntb,False,value)

def states():
    for ntb in range(37):
        for visible in range(1,7):
            a=[resolve("attack",visible,h,ntb) for h in range(1,7)]
            d=[resolve("defense",visible,h,ntb) for h in range(1,7)]
            yield ntb,visible,a,d

def mean(xs):
    return sum(Fraction(x) for x in xs)/len(xs)

def row(ntb,visible,a,d):
    return {
        "ntb":ntb,
        "visible":visible,
        "attack_success_p":float(mean(o.success for o in a)),
        "attack_kaputt_p":float(mean(o.kaputt for o in a)),
        "attack_expected_points":float(mean(o.points for o in a)),
        "attack_expected_next_ntb":float(mean(o.next_ntb for o in a)),
        "defense_expected_points":float(mean(o.points for o in d)),
        "defense_expected_next_ntb":float(mean(o.next_ntb for o in d)),
        "defense_beats_old_ntb_p":float(mean(o.success for o in d)),
        "extreme_p":float(mean(o.extreme for o in a)),
    }

def verify():
    # Structural invariants frozen in K3-E1.
    assert resolve("attack",1,6,10).value==36
    assert resolve("attack",6,1,10).value==36
    assert resolve("defense",1,6,10).value==2
    assert resolve("defense",6,1,10).value==2
    assert resolve("attack",6,6,10).value==36
    assert resolve("defense",1,1,10).value==2
    # Conditional polar symmetry.
    assert sum(resolve("defense",1,h,10).value==2 for h in range(1,7))==2
    assert sum(resolve("attack",6,h,10).value==36 for h in range(1,7))==2

def main():
    verify()
    rows=[row(*s) for s in states()]
    out=Path(__file__).with_name("k3e1_state_matrix.csv")
    with out.open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=rows[0].keys())
        w.writeheader(); w.writerows(rows)
    print(f"Wrote {len(rows)} states to {out}")
    print("K3-E1 invariants: OK")

if __name__=="__main__":
    main()

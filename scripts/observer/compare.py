# Research prototype: infers unit deaths from the replay's own selection lists and compares the
# resulting army value with an observer recording (scripts/observer/record.py) and with WC3V's.
# When a player switches selection, the replay lists every unit being deselected: the units really
# selected at that moment, without the dead ones (the game drops them from groups). A unit that stops
# appearing in later lists of the group it belonged to died in between.
#
#   node scripts/observer/actions.cjs <replay> <playerId> > <dir>/obs/p<playerId>.jsonl
#   python3 scripts/observer/compare.py <dir> <playerId> <wc3v.gz> <observer.jsonl> <game record.json>
import json,sys,gzip,collections
S=sys.argv[1]; pid=sys.argv[2]; wc3v=sys.argv[3]
m=lambda x:'%d:%02d'%(x//60000,x//1000%60)
acts=[json.loads(l) for l in open(f'{S}/obs/p{pid}.jsonl')]
o=json.load(gzip.open(wc3v))
units=o['players'][pid]['units']
htype={}
for u in units:
    if u.get('objectId1') is not None: htype[(u['objectId1'],u['objectId2'])]=u['itemId']
for a in acts:
    if a['id']==25 and a.get('objectId1') is not None: htype.setdefault((a['objectId1'],a['objectId2']),a['itemId'])
# true snapshots: a deselect (mode 2) followed at the same time by a select (mode 1) lists the whole current selection; an assign lists it too
snaps=[]
for i,a in enumerate(acts):
    if a['id']==22 and a.get('selectMode')==2 and i+1<len(acts) and acts[i+1]['id']==22 and acts[i+1].get('selectMode')==1 and acts[i+1]['t']==a['t']:
        snaps.append((a['t'],frozenset(map(tuple,a['units']))))
    elif a['id']==23:
        snaps.append((a['t'],frozenset(map(tuple,a['units']))))
seen=collections.defaultdict(list)
for t,s in snaps:
    for h in s: seen[h].append(t)
# death: the first later snapshot that shares most of the snapshot the unit was last in, but lacks the unit
death={}
for h,ts in seen.items():
    last=ts[-1]; base=[s for t,s in snaps if t==last and h in s][0]
    for t,s in snaps:
        if t<=last: continue
        if h in s: break
        if len(s & base)>=max(2,0.5*len(base-{h})):
            death[h]=(last,t); break
army=lambda ty: ty and ty[0].islower() and ty not in ('hpea','opeo','uaco','ewsp') and not ty.startswith('n')
print('snapshots',len(snaps))
for h,(a,b) in sorted(death.items(),key=lambda x:x[1]):
    print(' dead', h, htype.get(h,'?'), 'last seen',m(a),'gone by',m(b))

# ---- army estimate: units trained (WC3V's training times) minus deaths seen in the selection lists.
# Handles are typed by the game's own subgroup focus where known; the rest take the army type that
# still has trained units without a handle when they are first seen.
COST={'hfoo':135,'hrif':235,'hmpr':145,'hsor':175,'hkni':305,'hmtt':200,'hgyr':120,'hspt':230,'hdhw':225,'hgry':330}
trained=[u for u in units if army(u['itemId']) and u.get('trainedTime') is not None and not u.get('isIllusion')]
heroes={h for h,ty in htype.items() if ty and ty[0].isupper()}
armyish=lambda s: any(h in heroes or army(htype.get(h)) for h in s)
first={h:ts[0] for h,ts in seen.items()}
hs=sorted([h for h in seen if (army(htype.get(h)) or h not in htype) and any(h in s and armyish(s) for t,s in snaps)],key=lambda h:first[h])
assigned=collections.Counter(); htyp={}
for h in hs:
    ty=htype.get(h)
    if not ty:
        avail={t2: sum(1 for u in trained if u['itemId']==t2 and u['trainedTime']<=first[h])-assigned[t2] for t2 in {u['itemId'] for u in trained}}
        ty=max(avail,key=lambda k:avail[k]) if avail and max(avail.values())>0 else None
    if ty: htyp[h]=ty; assigned[ty]+=1
deaths=collections.defaultdict(list)
for h,ty in htyp.items():
    if h in death: deaths[ty].append(sum(death[h])/2)
def est(t,ty=None):
    tys=[ty] if ty else {u['itemId'] for u in trained}
    tot=0
    for k in tys:
        n=max(0,sum(1 for u in trained if u['itemId']==k and u['trainedTime']<=t)-sum(1 for d in deaths[k] if d<=t))
        tot+= n if ty else n*COST.get(k,200)
    return tot
match={}
truth=[json.loads(l) for l in open(sys.argv[4])]
pname={'2':'OrsoGrasso','3':'Pedrovisk'}[pid]
def tval(p):
    return sum(COST.get(x['id'],0)*x['alive'] for x in p['units'] if army(x['id']))
rec=json.load(open(sys.argv[5]))
ser=[sp for sp in rec['sim']['players'] if str(sp['playerId'])==pid][0]['series']
def cur(t):
    best=ser[0]
    for s in ser:
        if s['t']<=t: best=s
    return best.get('armyValue',0)
print('matched', len(htyp), 'army handles', dict(assigned))
err_new=err_cur=0;n=0
for r in truth:
    t=r['game']['t']; p=[x for x in r['players'] if x['name']==pname][0]
    tv=tval(p); nv=est(t); cv=cur(t)
    err_new+=abs(nv-tv); err_cur+=abs(cv-tv); n+=1
    if n%4==0: print(m(t),'rifles real',{x['id']:x['alive'] for x in p['units']}.get('hrif'),'new',est(t,'hrif'),'| army value real',tv,'new',nv,'current',cv)
print('mean abs error, army value: current',round(err_cur/n),'new',round(err_new/n))

# Trading Scanner MVP — ters sinyal güvenlik düzeltmesi

Bu repo, paylaşılan tarayıcı tabanlı scanner'daki **birkaç saniye içinde güçlü sinyalin tersine dönmesi** sorununu çözen `ConfluenceEngine` sürümünü içerir.

> Bu yazılım yatırım tavsiyesi vermez. Canlı hesapta kullanmadan önce paper trading ve geçmiş veri üzerinde test edilmelidir.

## Sorunun gerçek nedeni

Eski motorda beş kritik mantık problemi vardı:

1. `propose()` her çağrıldığında `checkConfluence()` hemen çalışıyordu. `proposalTimeoutMs = 3000` tanımlı olsa da motor diğer stratejilerin oylarını beklemiyordu; **ilk gelen teklif kazanıyordu**.
2. `sameDirectionMs` yalnızca aynı yönü yavaşlatıyordu. BUY'dan sonra SELL'i özel olarak kilitleyen bir kural yoktu.
3. “Skor 5”, beş ayrı teyit demek değildi. Tek bir stratejinin ağırlığı `5` olabiliyordu. Bu nedenle tek strateji BUY 5 üretip kısa süre sonra aynı veya başka strateji SELL 5 üretebiliyordu.
4. Açık/aktif sinyal varken karşıt sinyal üretimini engelleyen bir pozisyon kilidi yoktu.
5. Tekliflerde sembol tutulmadığı için sembol değişiminde eski teklifler yeni market kararına karışabiliyordu.

## Uygulanan korumalar

`src/confluence-engine.js` aşağıdaki kuralları uygular:

- Teklifler varsayılan **1 saniyelik değerlendirme penceresinde** toplanır.
- Her sinyal için en az **2 bağımsız strateji teyidi** gerekir; tek stratejinin skor 5 vermesi artık sinyal değildir.
- BUY ve SELL skoru arasındaki fark varsayılan olarak en az **2 puan** olmalıdır.
- Bir sembolde aktif sinyal varken yeni/ters sinyal üretilmez.
- Aktif sinyal kapansa bile ters yön varsayılan **120 saniye** kilitli kalır.
- Kilit sonrasındaki ters dönüş için en az **2 bağımsız strateji** gerekir.
- Ters sinyal skoru, önceki sinyalin skorunun en az **1,25 katı** olmalıdır. Önceki skor 5 ise yeni yön en az 7 puan ister.
- Engellenen teklifler tüketilir; aktif işlem kapanınca eski bir teklif aniden sinyal olmaz.
- Teklifler sembol bazında ayrılır.
- Fiyat oluşmadan sinyal üretilemez.
- Üretilen sinyale `confirmations`, `details` ve `diagnostics` alanları eklenir.

## Mevcut HTML'e entegrasyon

### 1. Motoru yükleyin

Paylaşılan HTML'de ana uygulama scriptinden hemen önce ekleyin:

```html
<script src="./src/confluence-engine.js"></script>
<script>
    // Strategy ve UltimateTradingCommandCenter sınıfları...
</script>
```

### 2. Eski sınıfı kaldırın

HTML içindeki eski:

```js
class ConfluenceEngine {
    // ...
}
```

bloğunu tamamen kaldırın. Diğer kod değişmeden `new ConfluenceEngine(this)` kullanmaya devam edebilir.

Motorun güvenli varsayılanları kendi içinde bulunduğundan bu iki adım düzeltmeyi etkinleştirmek için yeterlidir.

### 3. Ayarları kalıcı yapmak için önerilen ekleme

`loadSettings()` içindeki `defaults` nesnesine şu alanı ekleyin:

```js
signalSafety: {
    evaluationDelayMs: 1000,
    minScoreLead: 2,
    minConfirmations: 2,
    preventSignalsWhileActive: true,
    oppositeSignalLockMs: 120000,
    minReversalConfirmations: 2,
    reversalScoreMultiplier: 1.25,
    blockedNoticeThrottleMs: 10000
}
```

Kaydedilmiş eski ayarlarla birleştirirken de:

```js
signalSafety: {
    ...defaults.signalSafety,
    ...(saved.signalSafety || {})
}
```

satırını dönüş nesnesine ekleyin.

### 4. Sembol/zaman dilimi değişiminde teklifleri temizleyin

`resetDataForNewSymbol()` metodunun başına şunu eklemek önerilir:

```js
this.confluenceEngine.reset();
```

Motor zaten teklifleri sembol bazında ayırır; bu çağrı ayrıca bekleyen zamanlayıcıyı da temizler.

## Varsayılan güvenlik ayarları

| Ayar | Varsayılan | Açıklama |
|---|---:|---|
| `evaluationDelayMs` | 1000 ms | Diğer strateji oylarını toplama süresi |
| `minScoreLead` | 2 | Kazanan yönün karşıt skora minimum farkı |
| `minConfirmations` | 2 | Normal sinyal için gereken bağımsız strateji |
| `preventSignalsWhileActive` | `true` | Aktif işlem varken yeni sinyali kilitler |
| `oppositeSignalLockMs` | 120000 ms | Son sinyalden sonra ters yön kilidi |
| `minReversalConfirmations` | 2 | Ters dönüşte gereken bağımsız strateji |
| `reversalScoreMultiplier` | 1.25 | Ters skorun önceki skora göre katsayısı |

## Test

Node.js 18 veya üzeri ile:

```bash
npm test
```

Testler şu senaryoları kapsar:

- BUY 5 ve SELL 5 aynı değerlendirme penceresinde çatışma sayılır.
- Tek stratejinin skor 5 oyu, ikinci bağımsız teyit olmadan yayınlanmaz.
- Aktif BUY varken SELL 10 bile yayınlanmaz.
- İşlem kapandıktan sonra 120 saniyelik ters yön kilidi uygulanır.
- Kilit sonrasında iki bağımsız teyit ve daha yüksek skor aranır.
- BUY 5 / SELL 4 gibi çekişmeli durum sinyal sayılmaz.
- BTC teklifleri ETH skoruna karışmaz.

# Trading Scanner MVP — ters sinyal güvenlik düzeltmesi

**Canlı uygulama:** https://ahmetbysoy.github.io/trading-scanner-mvp/

Bu repo, paylaşılan tarayıcı tabanlı scanner'daki **birkaç saniye içinde güçlü sinyalin tersine dönmesi** sorununu çözen `ConfluenceEngine` sürümünü ve GitHub Pages üzerinde çalışan scanner arayüzünü içerir.

> Bu yazılım yatırım tavsiyesi vermez. Canlı hesapta kullanmadan önce paper trading ve geçmiş veri üzerinde test edilmelidir.

## Mobil uygulama deneyimi

720px ve altındaki ekranlarda masaüstü dashboard'u üst üste yığmak yerine ayrı bir mobil uygulama kabuğu açılır:

- **Ana Sayfa:** piyasa seçimi, sistem yaşam döngüsü, canlı metrikler ve güvenlik özeti
- **Piyasa:** tam ekran grafik / emir defteri ısı haritası ve dokunmatik zoom
- **Sinyaller:** aktif pozisyon kilidi, geçmiş, sonuçlar ve katkı detayı
- **Öğrenme:** live/shadow ölçümleri, rejim ve adaptif ağırlıklar; telefonda yatay tablo yerine okunabilir strateji kartları
- **Ayarlar:** mobilde tam ekran güvenlik, cooldown, öğrenme ve strateji ayarları; hızlı bölüm navigasyonu
- **Sinyal detayı:** yatay kaydırma gerektirmeyen contributor kartları, net katkı ve yüzdelik dağılım

Üst canlı ticker ve alt navigasyon sabittir; iOS/Android güvenli alanları hesaba katılır. Son mobil ekran ile grafik/heatmap seçimi cihazda saklanır. `manifest.webmanifest` ve `sw.js` sayesinde desteklenen tarayıcılarda ana ekrana bağımsız uygulama olarak kurulabilir. Masaüstü düzeni 720px üstünde korunur.

Mobil Piyasa görünümü enstrüman fiyatına göre eksen hassasiyetini otomatik seçer ve ekran genişliğine göre son 42–72 mumu odaklayarak mumları okunabilir boyutta tutar. Zoom araçları sağ fiyat ekseninden uzaktadır. Isı haritasında satış derinliği sağdan, alış derinliği soldan büyür; renkli ayraç ve `SATIŞ` / `ALIŞ` etiketleri makası belirginleştirir.

Canlı veri, Binance USDⓈ-M Futures'ın güncel yönlendirilmiş WebSocket adreslerini kullanır: fiyat ve işlem akışı `/market` üzerindeki `@aggTrade` (100 ms), mumlar `@kline`, 24 saatlik istatistikler `@ticker`, derinlik ise ayrı `/public` bağlantısındaki `@depth20@100ms` kaynağından gelir. REST geçmiş verisi gecikse veya erişilemese bile trade akışı fiyatı ve canlı mumu başlatır; sekiz saniye veri gelmeyen bağlantı otomatik yenilenir.

### Canlı komuta omurgası

Bütün çalışma zamanı bileşenleri sıralı, geçmişi sınırlı bir olay omurgası üzerinden haberleşir:

1. `market.trade`, `market.price`, `market.orderbook` ve `market.candle.*` olayları veri katmanından yayınlanır.
2. Mikro-yapı stratejileri her trade/depth olayını; mum stratejileri her kapanış ve periyodik analiz turunu aynı omurgadan alır.
3. Her strateji teklifi `proposal.created` ile shadow öğrenmeye, aktif stratejiler için `confluence.proposal.received` ile karar motoruna gider.
4. Confluence sonucu `confluence.evaluated`; sinyal yaşam döngüsü `signal.generated`, `signal.blocked` ve `signal.closed` olarak yayınlanır.
5. Adaptif motor sonuçları, rejimi, ağırlıkları ve cooldown'ları günceller; Canlı Komuta Akışı paneli trade hızı, mum/depth senkronu, strateji teklifleri ve son kararı görünür kılar.

Bir stratejide çalışma zamanı hatası oluşursa `strategy.error` olayı yayınlanır; diğer stratejilerin veri alması kesilmez ve panel sistemi bozulmuş gibi `STRATEJİ HATASI` durumuna geçirir.

Kono kaynak incelemesindeki “kullan / uyarla / reddet” kararları için [`docs/kono-mobile-analysis.md`](docs/kono-mobile-analysis.md) belgesine bakın.

## Adaptif hibrit öğrenme

Scanner artık `src/adaptive-learning.js` üzerinden sınırlandırılmış bir öğrenme katmanı kullanır:

- Aktif ve pasif bütün strateji teklifleri shadow TP/SL ile takip edilir.
- Nihai sinyale katkıda bulunan stratejilerin live sonuçları ayrıca ölçülür.
- İstatistikler sembol, zaman dilimi ve piyasa rejimi bağlamında tutulur.
- Bayesian başarı oranı, ortalama R ve EWMA R beraber değerlendirilir.
- İlk 20 etkili örnek boyunca ağırlıklar nötr (`1.00`) kalır.
- Sonrasında ağırlıklar varsayılan olarak yalnızca `0.65–1.35` aralığında değişebilir.
- Mikro-yapı stratejilerinin cooldown değerleri kayıp serisi, R beklentisi ve güvenilirliğe göre yavaşça optimize edilir.
- Mum tabanlı stratejiler aynı kapanmış mumda yalnızca bir teklif verebilir.
- Global ve ters yön cooldown korumaları yalnızca güvenli yönde ayarlanır; hard sinyal kilitleri optimizer tarafından kapatılamaz.
- Conviction state machine yön baskısının birden fazla zaman penceresinde kalıcı olmasını ister.
- Minimum iki farklı strateji ailesi gerekir ve tek ailenin toplam skora katkısı `%60` ile sınırlanır.
- Ters sinyal için ek skor histerezisi ve `0.5 ATR` fiyat geçersizliği uygulanır.
- Gerçek Wilder ADX, yön ve volatiliteyle rejim güveni hesaplanır; aile boost/cezaları en fazla `%8` ile sınırlıdır.
- Sinyal satırına veya aktif sinyaldeki **Katkıları canlı gör** düğmesine basılınca temel skor, öğrenme ağırlığı, rejim katsayısı, aile tavanı sonrası net katkı, katkı yüzdesi ve karşıt oylar görüntülenir.
- Strateji ikililerinin ortak sonuçları gelecekteki kombinasyon optimizasyonu için kaydedilir.
- Sürekli optimizasyon önerileri ve güvenli uygulama sırası [`docs/continuous-optimization-roadmap.md`](docs/continuous-optimization-roadmap.md) belgesinde listelenir.
- Veriler tarayıcıdaki IndexedDB'de saklanır ve panelden JSON olarak dışa aktarılabilir.

Öğrenme Merkezi üç çalışma modu sunar:

- **Otomatik:** Warm-up sonrasında sınırlı ağırlık ve cooldown optimizasyonu uygulanır.
- **Sadece Shadow:** Sonuçlar toplanır fakat sinyal skorlarına uygulanmaz.
- **Durduruldu:** Öğrenme ve adaptif etkiler kapatılır; temel ayarlar kullanılır.

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

Node.js unit/smoke testleri:

```bash
npm test
```

Gerçek Chromium üzerinde masaüstü ve mobil Playwright testleri:

```bash
npm run test:e2e
```

Bütün doğrulamalar:

```bash
npm run test:all
```

Playwright paketiyle birlikte gelen tarayıcı indirmesi doğrudan erişilebilir değilse test hazırlama betiği `@sparticuz/chromium` içindeki eşleşen Chromium binary'sini otomatik hazırlar.

Testler şu senaryoları kapsar:

- BUY 5 ve SELL 5 aynı değerlendirme penceresinde çatışma sayılır.
- Tek stratejinin skor 5 oyu, ikinci bağımsız teyit olmadan yayınlanmaz.
- Aktif BUY varken SELL 10 bile yayınlanmaz.
- İşlem kapandıktan sonra 120 saniyelik ters yön kilidi uygulanır.
- Kilit sonrasında iki bağımsız teyit ve daha yüksek skor aranır.
- BUY 5 / SELL 4 gibi çekişmeli durum sinyal sayılmaz.
- BTC teklifleri ETH skoruna karışmaz.
- Contributor net katkısı ve yüzdesi aile tavanı sonrasında doğru dağıtılır.
- Masaüstü dashboard, ayarlar, tema, chart/heatmap, start/stop ve öğrenme dışa aktarımı gerçek Chromium'da çalışır.
- Mobil alt navigasyon, görünüm kalıcılığı, tam ekran dialoglar, sinyal rozeti ve dokunma hedefleri gerçek mobil viewport'ta çalışır.
- Gerçek Lightweight Charts paketiyle BTC ekseninin iki ondalık basamak kullandığı, okunabilir mobil mum aralığının odaklandığı ve araçların fiyat ekseniyle çakışmadığı doğrulanır.
- Güncel `/market` ve `/public` Binance Futures WebSocket adresleri, ardışık `@aggTrade` fiyatları ve REST tamamen kesikken canlı mum oluşturma davranışı tarayıcı seviyesinde doğrulanır.
- Trade → fiyat/mum → strateji → adaptif öğrenme → confluence → komuta paneli zinciri gerçek Chromium DOM'u ve sıralı olay geçmişi üzerinde doğrulanır.

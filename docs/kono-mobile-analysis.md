# Kono referansı: satır sıralı inceleme ve mobil uyarlama kararı

Bu belge, verilen Kono tek-dosya HTML kaynağını yukarıdan aşağıya, ardışık kod blokları halinde inceler. Amaç kaynak kodu kopyalamak değil; yararlı ürün davranışlarını mevcut tarayıcının daha güvenli sinyal ve adaptif öğrenme motoruna taşımaktır.

## Karar özeti

**Doğrudan fikir olarak alınanlar**

- Sabit, kompakt canlı fiyat/ticker alanı
- Tam ekran uygulama kabuğu ve ekranlar arasında hızlı geçiş
- Grafik / emir defteri ısı haritası görünüm anahtarı
- Dokunmatik grafik yakınlaştırma araçları
- Ayarların ana akıştan ayrılması
- Bildirim katmanı
- Tema değişkenleri ve yerel görünüm tercihi
- Görselleştirmeyi görünür olduğunda yeniden boyutlandırma
- Mobilde geniş, tek elle kullanılabilir kontroller

**Bu projeye göre yeniden tasarlananlar**

- Kono'nun alta taşınmış, açılır uzun komut başlığı yerine semantik beş öğeli alt navigasyon
- Sabit `50vh` grafik yerine güvenli alanları hesaba katan `100dvh` ekran
- Küçük modal yerine mobilde tam ekran ayar ve sinyal detay sayfası
- Tüm panelleri üst üste yığmak yerine Ana Sayfa, Piyasa, Sinyaller ve Öğrenme ekranları
- Sadece chart/heatmap anahtarı yerine hem ekran hem görselleştirme tercihinin kalıcı tutulması

**Reddedilenler**

- Kono'nun basitleştirilmiş skor/confluence ve strateji mantığı
- Tek dosyada gömülü büyük CSS/JS yapısı
- Ayarların birden fazla yerde yinelenmesi
- Mobilde uzun kontrol formunu alt tarafa yapıştırma
- Güvenli alanı hesaba katmadan `overflow: hidden` kullanımı
- Mobil grafikte sabit yükseklik ve gizli analitik paneller
- Motorun aktif sinyal kilidi, bağımsız aile teyidi, conviction, ters yön histerezisi ve ATR geçersizliği olmadan çalıştırılması

## Kaynak sırasına göre inceleme

| Sıra / kaynak bloğu | Kono'daki görev | Karar | Bu projedeki karşılığı |
|---|---|---|---|
| Belge başı ve başlık | Tek sayfalı “Trading Komuta Merkezi” kabuğunu tanımlar. | **Uyarlama** | Mevcut semantik HTML korunur; mobil PWA metaları, manifest ve ikon eklenir. |
| `:root` tema değişkenleri | Koyu, açık ve “war” tema renklerini; ticker/header yüksekliğini tanımlar. | **Kısmi kullanım** | Var olan koyu/açık tasarım tokenları korunur. Yeni mobil yükseklik ve safe-area tokenları eklenir. “War” tema alınmaz; sinyal yönü görsel temaya dönüşmemelidir. |
| Tema seçicileri | Tema başına arka plan, metin, sınır, giriş ve vurgu renklerini değiştirir. | **Kullanım** | Mevcut `data-theme` sistemi ve grafik tema yenilemesi aynen korunur. |
| Evrensel reset ve `body` | Sıfırlama, monospace yazı tipi ve viewport taşmasını kapatır. | **Uyarlama** | Masaüstünün kaydırması bozulmaz. Yalnızca mobil breakpoint'te gerçek ekran kabuğu ile kontrollü taşma kullanılır. |
| `#super-top-ticker` | Fiyatı en üstte sürekli görünür tutar. | **Kullanım** | Mobil üst bar sabitlenir; sembol, fiyat, 24 saat değişimi ve aktif sayfa adı görünür kalır. |
| Ticker sol/sağ grupları | Piyasa özeti ile küçük eylemleri ayırır. | **Uyarlama** | Mobilde tema düğmesi sağda kalır; ayarlar alt navigasyona taşınır. |
| `.container` tam yükseklik | Ticker altında kalan alanı uygulama yüzeyi yapar. | **Kullanım** | `100dvh`, üst bar, alt bar ve cihaz güvenli alanlarından hesaplanan kaydırılabilir uygulama yüzeyi kullanılır. |
| `.header` ve `.header-top-bar` | Komut kontrollerini açılıp kapanan panelde toplar. | **Fikir olarak kullanım** | Kontroller Ana Sayfa ekranına alınır. Paneli alta yapıştırmak yerine gerçek alt sekme navigasyonu kullanılır. |
| `.header-collapsible-content` | Kontrol alanını max-height/opaklık ile açıp kapatır. | **Reddetme** | Mobil temel navigasyon, açılır uzun bir form olmamalıdır. Ekran değişimi daha öngörülebilirdir. |
| `.main-controls`, `.form-control`, `.status` | Sembol, zaman aralığı, başlat/durdur ve bağlantıyı kompakt gösterir. | **Kullanım** | Aynı işlevler iki sütunlu mobil kontrol kartına dönüştürülür; 390px altında tek sütun olur. |
| Durum noktası animasyonu | Canlı bağlantıyı hızlı taranabilir hale getirir. | **Kullanım** | Var olan çevrimiçi/offline rozeti ve pulse davranışı korunur. |
| Genel butonlar | Başlat, durdur ve küçük araç eylemleri sağlar. | **Uyarlama** | Mobil eylemler en az 44px hedefe ve yuvarlatılmış uygulama kontrolüne dönüştürülür. |
| `.main-grid` | Ana içeriği kalan viewport alanına sıkıştırır. | **Masaüstünde fikir, mobilde yeniden tasarım** | Masaüstü grid korunur. Mobilde wrapper `display: contents` olur ve paneller seçili ekran olarak gösterilir. |
| `.panel`, `.panel-title`, `.panel-content` | İçeriği kart/panel olarak bölümlendirir. | **Kullanım** | Mevcut paneller masaüstünde değişmez; mobilde uygulama sayfası niteliğinde 18px kart yüzeyleri olur. |
| Ayar grup ve form stilleri | Girdileri okunur gruplar halinde sunar. | **Kullanım** | Native `dialog`, mobilde tam ekran forma dönüşür; alanlar 44px ve tek/iki sütundur. |
| Grafik paneli | Grafik, başlık ve araçları ayrı görsel alanda tutar. | **Kullanım** | Piyasa sekmesi ekran yüksekliğini doldurur; chart görünür olunca yeniden boyutlandırılır. |
| Chart/heatmap seçim düğmeleri | İki piyasa görseli arasında geçiş yapar. | **Kullanım** | Segmented kontrol korunur; son görünüm `localStorage` ile hatırlanır. |
| Zoom araçları | Grafik ölçeğini hızlı ayarlar. | **Kullanım** | Grafik üstü araçlar korunur, mobil dokunma hedefleri büyütülür. |
| Heatmap canvas | Emir defteri yoğunluğunu görselleştirir. | **Kullanım** | Mevcut DPR-duyarlı heatmap motoru korunur; ekran/görünüm geçişinde resize ve redraw yapılır. |
| Sinyal/istatistik alanları | Sinyalleri ve özet sonucu panellerde gösterir. | **Geliştirilmiş kullanım** | Sinyaller ayrı alt sekmedir; aktif sinyal rozeti, aktif pozisyon kilidi, geçmiş, TP/SL ve win-rate aynı ekrandadır. |
| Settings modal CSS | Ayarları ana yüzeyin üstünde açar. | **Uyarlama** | Masaüstünde modal değişmez; mobilde cihaz güvenli alanlarını kullanan tam ekran ayar yüzeyi olur. |
| Notification CSS | Kısa geri bildirimleri sağ-alt köşede gösterir. | **Kullanım** | Mobilde bildirimler alt navigasyonun üstüne taşınır; navigasyonu kapatmaz. |
| Mobil breakpoint başlangıcı | Üst eylemleri azaltır ve komut alanını alta taşır. | **Fikir olarak kullanım** | Üstte yalnızca kritik ticker/tema kalır. Komut paneli değil, kalıcı beşli alt menü alta yerleşir. |
| Mobil `.header` sıralaması | Açılır kontrol başlığını sticky bottom yapar. | **Reddetme / değiştirme** | Uzun panel tek elle kullanımda içerik kapatır. Yerine Ana Sayfa, Piyasa, Sinyaller, Öğrenme, Ayarlar navigasyonu gelir. |
| Mobil kontrol yığını | Tüm form elemanlarını yüzde 100 genişlikte üst üste koyar. | **Uyarlama** | Orta telefonlarda iki sütun, dar telefonlarda tek sütun kullanılır; başlat/durdur yan yana kalır. |
| Mobil `50vh` grafik | Grafik alanına sabit göreli yükseklik verir. | **Reddetme** | Üst ve alt uygulama barları ile safe-area çıkarılarak kalan dinamik yükseklik kullanılır. |
| Mobil `150px` heatmap | Isı haritasını küçük sabit alana indirger. | **Reddetme** | Heatmap piyasa ekranının tüm kullanılabilir görselleştirme alanını kullanır. |
| Mobil modal tek sütunu | Dar ekranda ayar alanlarını tek sütuna indirger. | **Kullanım** | 390px altında tüm ayarlar tek sütuna geçer; daha geniş telefonda ilişkili alanlar iki sütundur. |
| Tema başlatma JS'i | Saklanan temayı yükler ve değiştirir. | **Kullanım** | Mevcut tema saklama sistemi korunur. |
| Header collapse JS'i | Panel açık/kapalı durumunu saklar. | **Kavramı kullanım** | Bunun yerine mobil ekran ve chart/heatmap tercihi saklanır. |
| Grafik oluşturma ve resize | Lightweight Charts'ı kurar, resize olaylarına yanıt verir. | **Kullanım** | Var olan `ResizeObserver` korunur; seçili mobil piyasa ekranı açıldığında ek resize çağrısı yapılır. |
| Heatmap çizimi | Bid/ask miktarını renk yoğunluğuna çevirir. | **Motoru kopyalama yok** | Bu projedeki mevcut DPR ve tema duyarlı heatmap kullanılır. |
| WebSocket akışı | Fiyat, mum ve order book akışını bağlar. | **Davranış korunur** | Mevcut bağlantı, reconnect ve sembol/timeframe değişim sistemi değiştirilmez. |
| Başlat/durdur olayları | Veri motorunun yaşam döngüsünü yönetir. | **Kullanım** | Aynı eylemler mobil Ana Sayfa'da bulunur; iş mantığı çoğaltılmaz. |
| Settings aç/kapat olayları | Modal formunu gösterir ve değerleri uygular. | **Kullanım** | Aynı ayar modeli masaüstü ve mobil tarafından paylaşılır. |
| Bildirim üretimi | Başarı/hata/bilgi mesajı gösterir. | **Kullanım** | Var olan notification sistemi mobil alt barı hesaba alacak şekilde konumlanır. |
| Strateji sınıfları | Çok sayıda teknik strateji üretir. | **Kopyalanmaz** | Bu projenin stratejileri, evidence-family sınıflandırması ve adaptif ağırlıkları korunur. |
| Confluence toplama | Kono oy/skorlarını basit eşikte birleştirir. | **Kesin reddetme** | Mevcut bağımsız strateji + bağımsız aile, aile katkı tavanı, temporal conviction ve skor farkı sistemi korunur. |
| Ters sinyal davranışı | Basit cooldown/aktif durum kontrolleri uygular. | **Kesin reddetme** | Aktif sinyal kilidi, ters yön zaman kilidi, daha yüksek teyit/skor, histerezis ve ATR tez geçersizliği korunur. |
| Adaptif/istatistik mantığı | Daha sınırlı performans takibi yapar. | **Kesin reddetme** | Bayesian/EWMA, live/shadow attribution, context/regime/pair metrikleri ve optimizer korunur. |
| Sayfa başlatma kodu | Kontrolleri bağlar ve ilk görünümü oluşturur. | **Uyarlama** | Mobil navigasyon başlangıçta restore edilir; PWA service worker güvenli bağlamda kaydedilir. |

## Uygulanan mobil bilgi mimarisi

1. **Ana Sayfa** — sembol, zaman aralığı, bağlantı, başlat/durdur, canlı piyasa metrikleri ve güvenlik özeti.
2. **Piyasa** — grafik / order-book heatmap seçimi ve dokunmatik zoom.
3. **Sinyaller** — aktif pozisyon kilidi, sinyal geçmişi, sonuç istatistikleri ve katkı detayı.
4. **Öğrenme** — rejim, live/shadow sayıları, optimizer durumu ve strateji ağırlıkları.
5. **Ayarlar** — tam ekran güvenlik, cooldown, öğrenme ve strateji yapılandırması.

## Motor koruma sınırı

Mobil yeniden tasarım yalnızca sunum ve ekran durumunu değiştirir. `src/confluence-engine.js` ile `src/adaptive-learning.js` içindeki güvenlik/öğrenme kararları basitleştirilmemiştir. Masaüstü grid yapısı 720px üstünde aynı kalır; mobil ekran seçicileri yalnızca mobil media query içinde etkindir.

# Sürekli ve güvenli optimizasyon fikirleri

Amaç yalnızca win-rate'i yükseltmek değil; ücret, slippage ve risk sonrasında **istikrarlı beklenen değer** üretmektir. Aşağıdaki öneriler canlı güvenlik tabanlarını gevşetmeden, önce shadow ortamında denenmelidir.

## En yüksek öncelik

1. **Ücret ve slippage düzeltilmiş sonuç etiketi**  
   TP/SL sonucuna komisyon, tahmini spread, slippage ve funding eklenmeli. Öğrenme motoru brüt başarı yerine net `R` öğrenmeli.

2. **MFE / MAE ve zaman-aşımı kaydı**  
   Her sinyal için maksimum lehte hareket, maksimum aleyhte hareket ve hedefe ulaşma süresi kaydedilmeli. Bu veri TP/SL mesafesi ve sinyal son kullanma süresini optimize eder.

3. **Olasılık kalibrasyonu**  
   Skor yalnızca “güçlü/zayıf” olmamalı; geçmiş sonuçlardan kalibre edilmiş başarı olasılığına dönüşmeli. Brier score ve reliability diagram ile “%70” denilen sinyallerin gerçekten yaklaşık %70 sonuçlanıp sonuçlanmadığı izlenmeli.

4. **Beklenen değer kapısı**  
   Yayın kararı yalnızca confluence skoruyla değil, `P(TP) × kazanç - P(SL) × kayıp - maliyet` pozitif olduğunda verilmeli. Güvenlik teyitleri yine zorunlu kalmalı.

5. **Champion / Challenger modeli**  
   Canlı ayar “champion” olarak sabit kalırken yeni ağırlık/parametreler yalnızca shadow “challenger” olarak çalışmalı. Challenger yeterli bağımsız örnekte daha iyi ve daha güvenli ise kademeli terfi etmeli.

6. **Walk-forward doğrulama**  
   Optimizasyon geçmişin tamamında yapılmamalı. Sıralı eğitim/doğrulama pencereleri, purge aralığı ve embargo kullanılarak geleceğe sızıntı engellenmeli.

7. **Otomatik geri alma ve circuit breaker**  
   Yeni modelde drawdown, ardışık kayıp, kalibrasyon bozulması veya veri hatası sınırı aşılırsa son güvenli snapshot'a otomatik dönülmeli. Minimum teyit ve ters yön kilidi hiçbir optimizer tarafından düşürülememeli.

## Strateji katkısını daha doğru öğrenme

8. **Marjinal katkı / ablation ölçümü**  
   Bir sinyal sonuçlandığında yalnızca kazanan contributor'ları ödüllendirmek survivorship bias üretir. Her strateji çıkarıldığında kararın değişip değişmediği hesaplanarak marjinal katkı ölçülmeli.

9. **Shapley-benzeri sınırlı kredi dağıtımı**  
   Küçük contributor gruplarında sonuç kredisi skor oranına göre değil, koalisyona sağladığı ek karar gücüne göre dağıtılabilir. Hesap maliyeti için tam Shapley yerine örneklemeli yaklaşım yeterlidir.

10. **Aile içi korelasyon cezası**  
    Aynı veriyi farklı adlarla tekrar eden yüksek korelasyonlu stratejiler bağımsız teyit sayılmamalı. Rolling korelasyon veya karar-benzerliği yüksek çiftlerin ortak katkısı azaltılmalı.

11. **İkili ve üçlü sinerji modeli**  
    Mevcut pair kayıtları genişletilerek hangi kombinasyonların belirli rejimde birlikte gerçekten ek değer ürettiği ölçülmeli. Sinerji bonusu küçük, sınırlı ve yeterli örneğe bağlı olmalı.

12. **Negatif contributor öğrenmesi**  
    Sinyal yönüne katılan fakat sürekli sonucu kötüleştiren strateji yalnızca düşük ağırlık almamalı; belirli bağlamda veto/uyarı adayı olarak da ölçülmeli. Otomatik veto önce shadow'da doğrulanmalı.

## Rejim ve bağlam iyileştirmeleri

13. **Hiyerarşik Bayesian shrinkage**  
    Sembol × timeframe × rejim hücrelerinde az örnek varsa global strateji istatistiğine doğru shrink edilmeli. Böylece küçük örnekli bağlamlarda aşırı ağırlık oluşmaz.

14. **Rejim geçiş tamponu**  
    Trend/range rejimi değiştiği anda ağırlıkları sert değiştirmek yerine geçiş güveni ve minimum kalış süresi kullanılmalı. Kararsız geçiş bölgelerinde sinyal eşiği yükseltilmeli.

15. **Volatilite ve likidite oturumları**  
    Öğrenme bağlamına düşük/normal/yüksek volatilitenin yanında spread, order-book derinliği, işlem saati ve hafta içi/hafta sonu eklenebilir.

16. **Çoklu zaman dilimi teyidi**  
    Üst timeframe trendi bağlama eklenebilir; ancak aynı mum verisinin türevleri ayrı bağımsız aile sayılmamalı. Üst timeframe sadece sınırlı rejim katsayısı vermeli.

17. **Concept drift algılama**  
    ADWIN, Page-Hinkley veya posterior değişim testiyle stratejinin performans dağılımı değiştiğinde eski örneklerin etkisi kontrollü azaltılmalı; ani drift'te strateji shadow'a alınmalı.

## Güvenli otomatik optimizasyon

18. **Sınırlandırılmış parametre araması**  
    RSI/ATR periyodu, threshold ve cooldown gibi parametreler geniş grid yerine küçük komşulukta aranmalı. Her adım için maksimum değişim oranı ve hard alt/üst sınır bulunmalı.

19. **Contextual bandit yalnızca shadow keşifte**  
    Thompson Sampling gibi yöntemler alternatif ağırlıkları shadow işlemlerde deneyebilir. Canlı kararda rastgele exploration yapılmamalı.

20. **Promotion kriteri**  
    Challenger'ın terfisi için minimum örnek, pozitif net expectancy, kabul edilebilir drawdown, daha iyi kalibrasyon ve birden fazla piyasa rejiminde tutarlılık birlikte aranmalı.

21. **Kademeli yayın**  
    Yeni parametre önce sinyallerin küçük bir kısmında veya yalnızca tek sembolde etkinleşmeli; sorun yoksa kapsam artırılmalı. Tarayıcı tek kullanıcılı olduğundan bu, zaman dilimli canary pencereleriyle yapılabilir.

22. **Optimizer bütçesi**  
    Günlük/haftalık maksimum ağırlık değişimi, maksimum aktif parametre değişikliği ve minimum bekleme süresi olmalı. Sürekli optimize etmek, sürekli parametre değiştirmek anlamına gelmemeli.

## Veri ve izlenebilirlik

23. **Karar anı immutable snapshot**  
    Her sinyalde fiyat, candle kimliği, order book özeti, indikatörler, ham teklifler, adaptif ağırlıklar, aile tavanı ve net contribution değişmez karar izi olarak saklanmalı.

24. **Veri kalitesi kapısı**  
    Eksik candle, sıra dışı spread, kopuk WebSocket, gecikmiş ticker veya order-book sequence hatasında sinyal motoru otomatik beklemeye geçmeli.

25. **Near-miss ve engellenen karar günlüğü**  
    Yalnızca üretilen sinyaller değil; aile çeşitliliği, skor farkı, conviction veya cooldown nedeniyle engellenen adaylar da shadow sonuçla takip edilmeli. Böylece eşiklerin fazla sıkı/gevşek olduğu ölçülebilir.

26. **Model sağlık paneli**  
    Son 30/100 sonuç için net expectancy, drawdown, Brier score, katkı yoğunlaşması, rejim dağılımı, drift alarmı ve champion/challenger farkı gösterilmeli.

## Önerilen uygulama sırası

### Faz 1 — Ölçüm kalitesi

- Net maliyetli `R`, MFE/MAE, sinyal süresi
- Immutable karar snapshot'ı
- Data-quality guard
- Engellenen adayların shadow takibi
- Kalibrasyon ve expectancy dashboard'u

### Faz 2 — Güvenli karşılaştırma

- Champion/challenger altyapısı
- Walk-forward replay
- Marjinal contributor kredisi
- Drift algılama
- Otomatik rollback

### Faz 3 — Sınırlı otonom optimizasyon

- Hiyerarşik bağlam ağırlıkları
- Shadow contextual bandit
- Çok kriterli promotion
- Zaman dilimli canary yayın

## Kaçınılması gerekenler

- Son birkaç işleme bakarak ağırlığı hızlı değiştirmek
- Win-rate'i tek başına hedeflemek
- Canlıda rastgele exploration yapmak
- Backtest ve validation verisini karıştırmak
- Minimum teyit, aktif sinyal kilidi veya ters yön korumasını optimizer'a açmak
- Aynı veri ailesindeki stratejileri bağımsız teyit saymak
- Model sürümü ve geri alma noktası olmadan otomatik yayın yapmak

$(function () {

    Application = BaseApplication.extend({

        initialize: function () {

            this.constructor.__super__.initialize.apply(this);

            function setHeader() {
                if ($(window).scrollTop() > 100) {
                    $('header').addClass('scrolled');
                }
                else {
                    $('header').removeClass('scrolled');
                }
            }

            this.on("controllerRendered", function () {

                $('.dropdown-toggle').dropdown();

                $('.toggle-methodics-menu').click(function () {
                    if (!$('.methodics-menu').hasClass('slide-in')) {
                        $('.methodics-menu').removeClass('slide-out').addClass('slide-in');
                    } else {
                        $('.methodics-menu').removeClass('slide-in').addClass('slide-out');
                    }
                })

                $("[data-toggle]").click(function () {
                    var toggle_el = $(this).attr("data-toggle");
                    $(toggle_el).toggleClass("open-sidebar");
                });

                $(".service-hint-btn-close").click(function() {
                    $(".service-content-inner").toggleClass("right-panel");
                    Yii.app.currentController.navigate($(this).attr("data-href"), 'normal', {
                        noPush: 1,
                        noState: 1,
                        custom: function() { Yii.app.loading(false); },
                        noSetModel: 1
                    })
                });

                if(window.innerWidth <= 1360) {
                    $(".service-content-inner").removeClass("right-panel");
                }

                if (typeof gtag != 'undefined') {

                    gtag('js', new Date());
                    gtag('config', 'G-MBJ5GRS5DK', {
                        'page_title': Yii.app.currentController.model.get("pageTitle"),
                        'page_path': Yii.app.currentController.url,
                        'send_page_view': false,
                        'custom_map': {
                            'dimension1': 'role',
                            'dimension2': 'language',
                            'dimension3': 'organization'
                        }
                    });

                    params = Yii.app.currentController.model.get("gtag");
                    if (!params) {
                        params = {};
                    }

                    gtag('event', 'page_view', params);

                    $(Yii.app.currentController.el).find("*[gtag-event]").click(function () {
                        var title = $(this).attr('gtag-title') ? $(this).attr('gtag-title') : 'Sent Event';
                        var event = $(this).attr("gtag-event");
                        gtag('config', window.GTAG_ID, {
                            'page_title': title,
                            'page_path': event
                        });
                    });
                }

                if ($(Yii.app.currentController.el).find(".ya-share2").length && typeof Ya != 'undefined') {
                    Ya.share2($(Yii.app.currentController.el).find(".ya-share2")[0], {
                        content: $(Yii.app.currentController.el).find(".ya-share2").data()
                    });
                }

                setHeader();
                $(window).bind('resize', function () {
                    setHeader();
                });
                $(document).bind('scroll', function () {
                    setHeader();
                });


                if (typeof $.fn.stickyTableHeaders != 'undefined')
                {
                    $(".table").stickyTableHeaders({fixedOffset: $('.site-header')});
                    $(".table-container").scroll(function() {
                        $(window).trigger('resize.stickyTableHeaders');
                    });
                }

                // @deprecated, используйте хендлер ниже, с классом
                $("#sp-table-test").on("scroll", function (event) {
                    // при горизонтальном скролле также скроллить fixed заголовок таблицы
                    $(window).trigger('resize.stickyTableHeaders');
                });

                $(".recalc-sticky-headers-on-scroll").on("scroll", function (event) {
                    // при горизонтальном скролле также скроллить fixed заголовок таблицы
                    $(window).trigger('resize.stickyTableHeaders');
                });

                $('[data-toggle="tooltip"]').tooltip();

                var $_bottom_menu = $('[data-toggle="menuProfileBottom"]');
                $_bottom_menu.on('click', function (e) {
                    e.preventDefault();
                    $('.main-content-sidebar').toggleClass('open');
                });


                var down;
                $(document).mouseup(function(e){down = false;});
                $(Yii.app.currentController.el).find(".table-container").each(function() {

                    var x,y,top,left;
                    $(this).mousedown(function(e) {
                        if (!$(e.target).hasClass('form-control')) {
                            e.preventDefault();
                            down = true;
                            x = e.pageX;
                            left = $(this).scrollLeft();
                        }
                    });

                    $(this).mousemove(function(e){

                        if(down){
                            var newX = e.pageX;
                            $(this).scrollLeft(left - newX + x);
                        }
                    });

                });

            });

        },

    })

})
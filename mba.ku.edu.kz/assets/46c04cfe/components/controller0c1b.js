$(function() {

    /**
     * Базовый класс контроллера
     * @type {*|void|extend|extend|extend|extend}
     */
    BaseController = BaseComponent.extend({
        // Название контроллера
        name : null,
        // Загружен ли контроллера (пришел не через аякс)
        loaded : false,
        // Текущий урл контроллера
        url : null,
        // Базовый урл ( в случае модального окна )
        baseUrl : null,
        // Модель контроллера
        model : null,
        // Класс базовой модели контроллера
        modelClass : "BaseModel",

        action : null,

        target : null,

        template : null,

        noState : false,

        sync : BaseSync,

        scrollTop : false,

        external : false,

        options : {},

        widgets : {},
        forms : {},

        /**
         * Инициализация контроллера
         * @param args
         * @returns {boolean}
         */
        _initialize : function(args) {

            if (typeof args.url != 'undefined') {
                this.url = args.url;
            } else {
                $.jGrowl("Set controller url", {
                    sticky:false,
                    theme:'error',
                    life:6000
                });
                //return false; //asd
            }

            this.app = args.app;

            if (typeof args.baseUrl != 'undefined') {
                this.baseUrl = args.baseUrl;
            }

            if (typeof args.external != 'undefined') {
                this.external = args.external;
            }

            if (typeof args.noState != 'undefined') {
                this.noState = args.noState;
            }

            if (typeof args.target != 'undefined') {
                this.target = args.target;
            }

            if (typeof args.name != 'undefined') {
                this.name = args.name;
            } else {
                $.jGrowl("Set controller name", {
                    sticky:false,
                    theme:'error',
                    life:6000
                });
                //return false;
            }
            if (typeof args.loaded != 'undefined') {
                this.loaded = args.loaded;
            }

            if (args.template) {
                if ($(args.template).length) {
                    this.template = _.template($(args.template).html());
                }
            }

            if (args.options) {
                this.options = args.options;
            }

            this.initializeModel();

        },


        /**
         * Рендеринг контроллера, регистрируются скрипты, определяется действие
         * действие определяется на основании аттрибута модели (action) и собирается
         * из слов "action" + model.action с большой буквы ( пр : actionIndex )
         */
        _render : function(response) {

            var that = this;

            this.loadModel(response.model);

            if (_.isEmpty(this.model.get("GET"))) {
                this.model.set("GET", {});
            }

            if (this.loaded) {
                this.setElement($(Yii.app.el));
            } else {
                // Если указан шаблон контроллера, а не элемент, то вызываем шаблон и заполняем данными
                if (this.template) {

                    var html = this.template({
                        html: response.html,
                        data: this.model.toJSON(),
                        options: this.options
                    });

                    $(response.html).filter('script[type!="text/template"]').each(function () {
                        $.globalEval(this.text || this.textContent || this.innerHTML || '');
                    });

                    // Устанавливаем элемент
                    this.setElement($(html));

                    // Если контроллер загружается в модальном окне, по добавляем в дом, если нет, то заменяем
                    if (this.target == "modal") {
                        $(Yii.app.el).append($(this.el));
                    } else if (this.target == 'popover') {
                        if ($(that.options.link).attr("aria-describedby")) {
                            $(that.options.link).popover("dispose");
                            $(that.options.link).removeAttr("aria-describedby");
                        } else {
                            $(that.options.link).popover({
                                content: $(this.el),
                                html: true,
                                title: this.model.get("pageTitle"),
                                trigger: 'manual'
                            })
                        }
                    } else {
                        var cls = $(this.el).attr("class");
                        cls = cls.split(" ");
                        var selector = '';
                        _(cls).each(function(c) {
                            selector += '.' + c;
                        });
                        $(Yii.app.el).find(selector).replaceWith($(this.el));
                    }
                } else {
                    // Если же указан элемент, то заполняем его вернутым хтмлом
                    $(this.el).html(response.html);
                }
                // Вызываем метод после загрузки
                this.afterLoad(response);
            }

            this.getFlash();
            this.loadAction();

            $(this.el).find(".slim-scroll").each(function() {
                var $el = $(this);
                var height = $el.height();
                $el.slimscroll({
                    height: height + 'px',
                    color: 'rgba(0,0,0,0.5)',
                    size: '6px',
                    alwaysVisible: false,
                    borderRadius: '0',
                    railBorderRadius: '0',
                    start : $el.attr("start") ? $el.attr("start") : "top"
                });
            });

            if (!that.external) {
                $(that.el).on("click", "a[href^='/'], *[href^='/']", function(event) {

                    if ($(event.target).attr("no-link") == '1') {
                        console.log('asd');
                        return;
                    }

                    var link = $(event.currentTarget);

                    if ($(link).attr("target") == '_blank') {
                        return true;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    var post = {};
                    if ($(link).parents("form").length) {

                        if (that.forms[$(link).parents("form").attr("id")]) {
                            post['formData'] = that.forms[$(link).parents("form").attr("id")].serialize()
                        }

                    }


                    var custom = false;
                    if ($(link).attr("partial")) {
                        post['partial'] = $(link).attr("partial");
                        custom = function (response) {

                            var selectors = $(link).attr("partial").split(',');

                            _(selectors).each(function(s) {

                                var $selector = s.split(':');

                                var $el = $(response.html).find($selector[0]);
                                if ($(link).attr("partial-append") == "1") {
                                    $(that.el).find($selector[0]).append($el.html());
                                } else {
                                    if ($selector[1] && $selector[1] == '1') {
                                        $(that.el).find($selector[0]).append($el.html());
                                    } if ($selector[1] && $selector[1] == 'r') {
                                        $(that.el).find($selector[0]).replaceWith($el);
                                    } else {
                                        $(that.el).find($selector[0]).html($el.html());
                                    }
                                }
                                if (!$(link).attr("noState")) {
                                    that.url = $(link).attr("href");
                                    Yii.app.pushState(that);
                                }

                            })
                            that.trigger('partialRendered', {
                                link: link
                            });
                        }
                    }

                    if ($(link).attr("data-inputs")) {

                        var inputs = $(link).attr("data-inputs").split(",");
                        if (inputs) {
                            var p_data = {};
                            var passed = true;
                            _(inputs).each(function(input) {

                                var input_data = input.split(':');
                                var input_el = $(that.el).find(input_data[0]);
                                if (input_data[1] && input_data[1] == 'r') {
                                    if (!input_el.val()) {
                                        input_el.addClass('is-invalid');
                                        passed = false;
                                    } else {
                                        input_el.removeClass('is-invalid');
                                    }
                                }
                                p_data[input_el.attr("name")] = input_el.val();

                            });

                            if (!passed) {
                                return false;
                            }

                            post = _.extend(post, p_data);

                        }

                    }

                    var noPush = $(link).attr("noPush") ? true : false;
                    var noState = $(link).attr("noState") ? true : false;
                    var noLoading = $(link).attr("noLoading") ? true : false;
                    var target = that.options.transaction ? ($(link).attr("target") ? $(link).attr("target") : that.target) : that.target;
                    if (target == 'popover') {
                        noPush = true;
                        noState = true;
                    }

                    var options = {
                        scroll : $(link).attr("noscroll") ? false : true,
                        transaction : $(link).attr("notransaction") ? false : (that.options.transaction !== false ? true : false),
                        custom: custom,
                        confirm : $(link).attr("confirm") ? $(link).attr("confirm") : null,
                        post: post,
                        no_push: noPush,
                        noState: noState,
                        link: link,
                        noLoading: noLoading
                    };

                    return that.navigate($(link).attr("href"), target, options);
                });
            }

            if (this.model.get("GET").scroll_to) {
                setTimeout(function() {
                    var el = $(that.el).find("*[scroll-to='"+that.model.get("GET").scroll_to+"']");
                    var offset = $(el).attr("offset") ? $(el).attr("offset") : 85
                    if (el.length) {
                        var speed = 500;
                        if ($(el).attr('data-scroll-speed')) {
                            speed = parseInt($(el).attr('data-scroll-speed'));
                        }
                        $(that.target == "modal" ? that.el : "html, body").stop().animate({ scrollTop: $(el).offset().top - offset }, speed);
                    }
                }, 500);
            }

            if (!Yii.app.user.isGuest && !this.external && !['modal', 'popover'].includes(this.target)) {
                if (typeof window.ENotifications != 'undefined') {
                    this.notifications = new ENotifications({
                        el: $('#notifications_main')
                    });
                    this.notifications.render();
                }
            }

            if (!['modal', 'popover'].includes(this.target)) {
                $("body").attr("class", this.model.get("body_custom_classes"));
            }

            if ($(this.el).find('.auto-form').length) {
                $(this.el).find('.auto-form').each(function() {
                    var el = this;
                    var model = new BaseModel(that.model.get($(this).attr("data-attributes")), {
                        yModel : $(this).attr("data-model")
                    });
                    var form = new EForm({
                        el : $(this),
                        model : model,
                        onSuccess : function(model,response) {
                            if (response.redirect) {
                                if (response.full) {
                                    window.location.href = response.redirect;
                                } else {
                                    if (response._csrf) {
                                        Yii.app._csrf = response._csrf;
                                    }
                                    that.navigate(response.redirect, response.target ? response.target : null, {
                                        scroll: response.scroll
                                    });
                                }
                            } else if (response.noAction) {
                            } else if (response.refresh) {
                                that.navigate(that.url, that.target, {
                                    scroll: false
                                });
                            } else {
                                if (['modal', 'popover'].includes(that.target)) {
                                    that.navigate(that.baseUrl, 'normal', {
                                        scroll: false
                                    });
                                } else {
                                    window.location.href = window.location.href;
                                }
                            }
                        }
                    });
                    form.render();
                    if ($(el).attr("id")) {
                        that.forms[$(el).attr("id")] = form;
                    }
                })
            }

            this.initiateWidgets(this.model.get("widgets"));
            this._csrf = this.model.get("_csrf");
            Yii.app.trigger("controllerRendered");

        },

        initiateWidgets: function(widgets) {

            var that = this;
            if (widgets) {
                _(widgets).each(function(widget) {
                    if (typeof window[widget] != 'undefined') {
                        that.widgets[widget] = new window[widget]({
                            el: that.el,
                            parent: that
                        });
                        that.widgets[widget].render();
                    }
                })
            }

        },

        navigate: function(href, target, options) {

            var that = this;

            var _o = {
                callback : that.options.callback ? that.options.callback : null,
                custom: null,
                transaction : that.options.transaction !== false,
                no_fade : (that.target == 'modal' && target == 'modal') ? true : false,
                link: null
            };

            options = _.extend(_o, options);

            Yii.app.navigate(href, target, options, this)

        },

        loadAction: function() {
            var that = this;
            // Получаем действие контроллера из модели
            var a = that.model.get("action");
            if (a) {

                // Составляем строку метода действия типа actionIndex
                var a_words = a.split("-");
                if (a_words.length > 1) {
                    a = "";
                    _(a_words).each(function(w) {
                        a = a + w.charAt(0).toUpperCase() + w.slice(1);
                    })
                }
                var action = "action" + a.charAt(0).toUpperCase() + a.slice(1);

                // Проверяем на наличие обьекта представления действия
                if (typeof that[action] != "undefined") {

                    // Проверяем если в модели указан элемент действия для представления
                    var ael = that.model.get("action_element");
                    if (!ael)
                    {
                        ael = ".action-element#action_" + that.model.get("controller") + "_" + that.model.get("action");
                    }

                    if (!$(that.el).find(ael).length)
                    {
                        throw "No action element present '" + ael + "' in DOM";
                    }

                    var f = [
                        "function (){ return parent.apply(this, arguments); } ",
                        "function () { return parent.apply(this, arguments); }",
                        "function(){return c.apply(this,arguments)}",
                        "function (){ return parent.apply(this, arguments); }",
                        "function (){return c.apply(this,arguments)}",
                        "function () {return c.apply(this,arguments);}",
                        "function(){ return parent.apply(this, arguments); }"
                    ]

                    if (f.indexOf(that[action].toString(-1)) !== -1){
                        // Создаем экземпляр представления действия
                        that.action = new that[action]({
                            el : $(that.el).find(ael),
                            controller : that
                        });
                        that.action.render();
                        that.action.ga();
                    } else {
                        that[action].call(that,$(that.el).find(ael));
                        that.ga();
                    }

                } else {

                    that.action = new BaseAction({
                        el : $(that.el).find(ael),
                        controller : that
                    });
                    that.action.render();
                    that.ga();
                }

            }
            //$(that.el).addClass("fadein");

            // Если контроллер запущен в модальном окне
            if (that.target == "modal") {
                // Показываем модальное окно
                $(that.el).modal("show");
                $(this.el).on("hidden.bs.modal", function () {

                    console.log('trying to hide');

                    if ($(this).attr("id") != 'controller_modal') {
                        return;
                    }

                    console.log('modal hidden');

                    if (that.options.transaction) {
                        if (!that.navigating) {

                            if (Yii.app.currentController.model.get("refreshOnClose")) {
                                that.target = null;
                                Yii.app.navigate(that.baseUrl, null, {
                                    scroll: false
                                });
                            }

                            var found = null;
                            console.log(Yii.app.controllers);
                            _(Yii.app.controllers).each(function(module) {
                                _(module).each(function(controller) {
                                    _(controller).each(function(a) {
                                        console.log(a.url);
                                        if (a.url == that.baseUrl && !found) {
                                            found = a;
                                        }
                                    });
                                });
                            });

                            if (found) {
                                Yii.app.currentController = found;
                                Yii.app.pushState(found);
                            }
                        }
                    }

                    that.__destroy();

                    if ($('body').find('.modal.show').length) {
                        if (!$('body').hasClass('modal-open')) {
                            $('body').addClass('modal-open');
                        }
                    }

                })

                console.log(Yii.app.top);
                if (that.scrollTop) {
                    $('#controller_modal').scrollTop(0);
                }  else {
                    if (Yii.app.top > 0) {
                        $('#controller_modal').scrollTop(Yii.app.top);
                    }
                    Yii.app.top = 0;
                }

            } else if (that.target == 'popover') {

                // Показываем модальное окно
                $(that.options.link).popover("show");
                $(that.options.link).on("hidden.bs.popover", function () {
                    that.__destroy();
                })

            } else {
                // Выставляем титл страницы
                if (!that.external) {
                    document.title = that.model.get("pageTitle");
                }

                if (that.scrollTop) {
                    $(document).scrollTop(0);
                }  else {
                    if (Yii.app.top > 0) {
                        $(window).scrollTop(Yii.app.top);
                    }
                    Yii.app.top = 0;
                }

            }

        },

        /**
         * Базовый метод действия
         * @param action
         * @private
         */
        _action : function(action) {

        },
        /**
         * Если действие не обьект, то выполняем аналитику с контроллера
         */
        ga : function() {
            if (typeof ga != "undefined") {
                ga('send', {
                    'hitType': 'pageview',
                    'page': this.url
                });
            }
        },
        /**
         * Инициализирует модель, если контроллер был загружен изначально (не аяксом)
         */
        initializeModel : function() {
            this.model = new window[this.modelClass](this.model);
            this.model.on("change", this.pushState, this);
        },
        /**
         * Инициализирует модель после загрузки контроллера через аякс
         * @param model
         */
        loadModel : function(model) {
            this.model = new window[this.modelClass](model);
        },

        /**
         * Выводит сообщения зарегистрированные в \Yii::$app->session->setFlash()
         */
        getFlash : function() {
            var flash = this.model.get("flash");
            if (flash) {
                Yii.app.showFlash(flash)
            }
        },

        /**
         * Показать хлебные крошки
         */
        breadcrumbs : function() {
            if (['modal', 'popover'].includes(this.target)) {
                Yii.app.breadcrumbs(this.model.get("breadCrumbs"));
            }
        },
        /**
         * Выполняется после загрузки контроллера
         * @param response - результат аякс запроса
         */
        afterLoad : function(response) {
        },
        scroll : function(id) {
            $(document.body).animate({
                'scrollTop':   $("#"+id).offset().top - 100
            }, 300);
        },
        __destroy: function() {

            if (this.action !== null && typeof this.action != 'function') {
                this.action.__destroy();
            }
            if (this.target == 'modal') {
				$(".modal-backdrop").first().remove();
                $(this.el).remove();
            }

            if (this.target == 'popover') {
                $(this.el).remove();
                $(this.options.link).popover('dispose');
            }

            if (Yii.app.socket) {
                Yii.app.socket.clear();
            }

            if (this.model) {
                if (Yii.app.controllers[this.model.get("module")]) {
                    if (Yii.app.controllers[this.model.get("module")][this.model.get("controller")]) {
                        if (Yii.app.controllers[this.model.get("module")][this.model.get("controller")][this.model.get("action")]) {
                            delete Yii.app.controllers[this.model.get("module")][this.model.get("controller")][this.model.get("action")];
                        }
                    }
                }
                delete this.model;
            }

            delete this.action;

        }
    })

})

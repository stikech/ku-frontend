$(function () {

    EPhoneField = BaseWidget.extend({

        afterRender() {
            $(this.el)
                .find('input.phone-input')
                .each((_, el) => initField($(el)));
        }
    });
});
function initField($input) {
    const lang = ($input.data('lang') || 'ru').toLowerCase();

    const baseName = $input.attr('name');
    const fullName = `${baseName}_full`;
    $input.attr({ name: fullName, id: fullName });

    const onlyCountries = (() => {
        const el = document.getElementById('country-list');
        try {
            return el ? JSON.parse(el.dataset.countries || '[]') : [];
        } catch (e) {
            console.warn('Неверный формат data-countries:', e);
            return [];
        }
    })();

    const iti = window.intlTelInput($input[0], {
        initialCountry:        'kz',
        nationalMode:          false,
        separateDialCode:      true,
        placeholderNumberType: 'MOBILE',
        onlyCountries,
        i18n: window.countryI18n[lang] || {},

        hiddenInput(name) {
            return {
                phone:   baseName,
                country: `${name}_iso2`,
            };
        },
    });


    if (iti.hiddenInput)        iti.hiddenInput.id        = baseName;
    if (iti.hiddenInputCountry) iti.hiddenInputCountry.id = `${baseName}_iso2`;

    const sync = () => {
        const full = iti.getNumber(intlTelInput.utils.numberFormat.E164);
        if (iti.hiddenInput)        iti.hiddenInput.value        = full;
        if (iti.hiddenInputCountry) iti.hiddenInputCountry.value = iti.getSelectedCountryData().iso2;
    };

    $input.on('input countrychange', sync);
    sync();
}

exports.monkeyPatchSignedXmlExclusiveCanonicalization = monkeyPatchSignedXmlExclusiveCanonicalization;

function monkeyPatchSignedXmlExclusiveCanonicalization(xmlcrypto) {
    // This is needed because exclusive-canonicalization implementation in xml-crypto library adds the namespace to xml:id attribute.
    // According to [http://www.w3.org/TR/2008/REC-xml-c14n11-20080502]:
    //     "The xml:id attribute is not a simple inheritable attribute and no processing of these attributes is performed."
    var origExclusiveCanonicalization = xmlcrypto.SignedXml.CanonicalizationAlgorithms['http://www.w3.org/2001/10/xml-exc-c14n#'];
    var monkeyPatchedExclusiveCanonicalization = function() {
        /*given a node (from the xmldom module) return its canonical representation (as string)*/
        this.process = function(node) {
            //you should apply your transformation before returning
            var canon = origExclusiveCanonicalization.prototype.process(node);
            canon = canon.replace(/xmlns:xml="" xml:id/, "xml:id");
            return canon;
        }

        this.getAlgorithmName = function() {
            return origExclusiveCanonicalization.prototype.getAlgorithmName();
        }
    }
    xmlcrypto.SignedXml.CanonicalizationAlgorithms['http://www.w3.org/2001/10/xml-exc-c14n#'] = monkeyPatchedExclusiveCanonicalization;
}